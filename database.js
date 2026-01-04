const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const dbPath = path.join(__dirname, 'messenger.db');
const db = new sqlite3.Database(dbPath);

// Initialize database tables
db.serialize(() => {
  // Users table with extended profile fields
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT DEFAULT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      avatar TEXT DEFAULT NULL,
      bio TEXT DEFAULT NULL,
      status TEXT DEFAULT 'offline',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add new columns if they don't exist (migration)
  db.run(`ALTER TABLE users ADD COLUMN display_name TEXT DEFAULT NULL`, () => { });
  db.run(`ALTER TABLE users ADD COLUMN bio TEXT DEFAULT NULL`, () => { });

  // Conversations table
  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      type TEXT DEFAULT 'private',
      name TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Conversation participants
  db.run(`
    CREATE TABLE IF NOT EXISTS conversation_participants (
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (conversation_id, user_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Messages table
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'text',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (sender_id) REFERENCES users(id)
    )
  `);

  // Channels table (only admins can post)
  db.run(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT NULL,
      avatar TEXT DEFAULT NULL,
      owner_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    )
  `);

  // Groups table (all members can post)
  db.run(`
    CREATE TABLE IF NOT EXISTS groups_table (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT NULL,
      avatar TEXT DEFAULT NULL,
      owner_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    )
  `);

  // Channel members
  db.run(`
    CREATE TABLE IF NOT EXISTS channel_members (
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (channel_id, user_id),
      FOREIGN KEY (channel_id) REFERENCES channels(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Group members
  db.run(`
    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES groups_table(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Channel messages
  db.run(`
    CREATE TABLE IF NOT EXISTS channel_messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'text',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (channel_id) REFERENCES channels(id),
      FOREIGN KEY (sender_id) REFERENCES users(id)
    )
  `);

  // Group messages
  db.run(`
    CREATE TABLE IF NOT EXISTS group_messages (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'text',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES groups_table(id),
      FOREIGN KEY (sender_id) REFERENCES users(id)
    )
  `);
});

// Database helper functions
const dbHelpers = {
  // User operations
  createUser: (username, email, password) => {
    return new Promise((resolve, reject) => {
      const id = uuidv4();
      const hashedPassword = bcrypt.hashSync(password, 10);

      db.run(
        'INSERT INTO users (id, username, email, password) VALUES (?, ?, ?, ?)',
        [id, username, email, hashedPassword],
        function (err) {
          if (err) reject(err);
          else resolve({ id, username, email });
        }
      );
    });
  },

  getUserByEmail: (email) => {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  getUserById: (id) => {
    return new Promise((resolve, reject) => {
      db.get('SELECT id, username, email, avatar, status FROM users WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  getUserByUsername: (username) => {
    return new Promise((resolve, reject) => {
      db.get('SELECT id, username, email, avatar, status FROM users WHERE username LIKE ?', [`%${username}%`], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  searchUsers: (query, currentUserId) => {
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT id, username, email, avatar, status FROM users WHERE (username LIKE ? OR email LIKE ?) AND id != ?',
        [`%${query}%`, `%${query}%`, currentUserId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  },

  updateUserStatus: (userId, status) => {
    return new Promise((resolve, reject) => {
      db.run('UPDATE users SET status = ? WHERE id = ?', [status, userId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  },

  // Conversation operations
  createConversation: (userId1, userId2) => {
    return new Promise((resolve, reject) => {
      // Check if conversation exists
      db.get(`
        SELECT c.id FROM conversations c
        JOIN conversation_participants cp1 ON c.id = cp1.conversation_id AND cp1.user_id = ?
        JOIN conversation_participants cp2 ON c.id = cp2.conversation_id AND cp2.user_id = ?
        WHERE c.type = 'private'
      `, [userId1, userId2], (err, existing) => {
        if (err) return reject(err);

        if (existing) {
          return resolve(existing.id);
        }

        const id = uuidv4();
        db.run('INSERT INTO conversations (id, type) VALUES (?, "private")', [id], (err) => {
          if (err) return reject(err);

          db.run('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)', [id, userId1]);
          db.run('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)', [id, userId2], (err) => {
            if (err) reject(err);
            else resolve(id);
          });
        });
      });
    });
  },

  getConversations: (userId) => {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          c.id,
          c.type,
          c.created_at,
          u.id as other_user_id,
          u.username as other_username,
          u.avatar as other_avatar,
          u.status as other_status,
          (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
          (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_time
        FROM conversations c
        JOIN conversation_participants cp ON c.id = cp.conversation_id
        JOIN conversation_participants cp2 ON c.id = cp2.conversation_id AND cp2.user_id != ?
        JOIN users u ON cp2.user_id = u.id
        WHERE cp.user_id = ?
        ORDER BY last_message_time DESC
      `, [userId, userId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  },

  // Message operations
  createMessage: (conversationId, senderId, content, type = 'text') => {
    return new Promise((resolve, reject) => {
      const id = uuidv4();
      const createdAt = new Date().toISOString();

      db.run(
        'INSERT INTO messages (id, conversation_id, sender_id, content, type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, conversationId, senderId, content, type, createdAt],
        function (err) {
          if (err) reject(err);
          else resolve({ id, conversationId, senderId, content, type, createdAt });
        }
      );
    });
  },

  getMessages: (conversationId, limit = 50) => {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          m.id,
          m.conversation_id,
          m.sender_id,
          m.content,
          m.type,
          m.created_at,
          u.username as sender_username
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.conversation_id = ?
        ORDER BY m.created_at ASC
        LIMIT ?
      `, [conversationId, limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  },

  getConversationParticipants: (conversationId) => {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT user_id FROM conversation_participants WHERE conversation_id = ?
      `, [conversationId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows ? rows.map(r => r.user_id) : []);
      });
    });
  },

  verifyPassword: (password, hash) => {
    return bcrypt.compareSync(password, hash);
  },

  updateProfile: (userId, updates) => {
    return new Promise((resolve, reject) => {
      const fields = [];
      const values = [];

      if (updates.display_name !== undefined) {
        fields.push('display_name = ?');
        values.push(updates.display_name);
      }
      if (updates.bio !== undefined) {
        fields.push('bio = ?');
        values.push(updates.bio);
      }
      if (updates.avatar !== undefined) {
        fields.push('avatar = ?');
        values.push(updates.avatar);
      }
      if (updates.username !== undefined) {
        fields.push('username = ?');
        values.push(updates.username);
      }

      if (fields.length === 0) {
        return resolve({ success: true });
      }

      values.push(userId);

      db.run(
        `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
        values,
        function (err) {
          if (err) reject(err);
          else resolve({ success: true, changes: this.changes });
        }
      );
    });
  },

  deleteUser: (id) => {
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        // Delete user's messages
        db.run('DELETE FROM messages WHERE sender_id = ?', [id]);
        // Delete user from conversation participants
        db.run('DELETE FROM conversation_participants WHERE user_id = ?', [id]);
        // Delete the user
        db.run('DELETE FROM users WHERE id = ?', [id], function (err) {
          if (err) reject(err);
          else resolve({ success: true, changes: this.changes });
        });
      });
    });
  },

  getFullUser: (id) => {
    return new Promise((resolve, reject) => {
      db.get('SELECT id, username, display_name, email, avatar, bio, status FROM users WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  // ===================== CHANNEL OPERATIONS =====================
  createChannel: (name, description, ownerId) => {
    return new Promise((resolve, reject) => {
      const id = uuidv4();
      db.run(
        'INSERT INTO channels (id, name, description, owner_id) VALUES (?, ?, ?, ?)',
        [id, name, description, ownerId],
        function (err) {
          if (err) reject(err);
          else {
            // Add owner as admin
            db.run('INSERT INTO channel_members (channel_id, user_id, role) VALUES (?, ?, ?)',
              [id, ownerId, 'admin'], () => { });
            resolve({ id, name, description, ownerId });
          }
        }
      );
    });
  },

  getUserChannels: (userId) => {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT c.*, cm.role,
          (SELECT content FROM channel_messages WHERE channel_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
          (SELECT created_at FROM channel_messages WHERE channel_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_time,
          (SELECT COUNT(*) FROM channel_members WHERE channel_id = c.id) as member_count
        FROM channels c
        JOIN channel_members cm ON c.id = cm.channel_id
        WHERE cm.user_id = ?
        ORDER BY last_message_time DESC
      `, [userId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  },

  joinChannel: (channelId, userId) => {
    return new Promise((resolve, reject) => {
      db.run('INSERT OR IGNORE INTO channel_members (channel_id, user_id, role) VALUES (?, ?, ?)',
        [channelId, userId, 'member'],
        function (err) {
          if (err) reject(err);
          else resolve({ success: true });
        }
      );
    });
  },

  getChannelMessages: (channelId, limit = 50) => {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT cm.*, u.username as sender_username
        FROM channel_messages cm
        JOIN users u ON cm.sender_id = u.id
        WHERE cm.channel_id = ?
        ORDER BY cm.created_at ASC
        LIMIT ?
      `, [channelId, limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  },

  createChannelMessage: (channelId, senderId, content, type = 'text') => {
    return new Promise((resolve, reject) => {
      const id = uuidv4();
      const createdAt = new Date().toISOString();
      db.run(
        'INSERT INTO channel_messages (id, channel_id, sender_id, content, type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, channelId, senderId, content, type, createdAt],
        function (err) {
          if (err) reject(err);
          else resolve({ id, channelId, senderId, content, type, createdAt });
        }
      );
    });
  },

  isChannelAdmin: (channelId, userId) => {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ? AND role IN (?, ?)',
        [channelId, userId, 'admin', 'owner'],
        (err, row) => {
          if (err) reject(err);
          else resolve(!!row);
        }
      );
    });
  },

  // ===================== GROUP OPERATIONS =====================
  createGroup: (name, description, ownerId) => {
    return new Promise((resolve, reject) => {
      const id = uuidv4();
      db.run(
        'INSERT INTO groups_table (id, name, description, owner_id) VALUES (?, ?, ?, ?)',
        [id, name, description, ownerId],
        function (err) {
          if (err) reject(err);
          else {
            // Add owner as admin
            db.run('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)',
              [id, ownerId, 'admin'], () => { });
            resolve({ id, name, description, ownerId });
          }
        }
      );
    });
  },

  getUserGroups: (userId) => {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT g.*, gm.role,
          (SELECT content FROM group_messages WHERE group_id = g.id ORDER BY created_at DESC LIMIT 1) as last_message,
          (SELECT created_at FROM group_messages WHERE group_id = g.id ORDER BY created_at DESC LIMIT 1) as last_message_time,
          (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
        FROM groups_table g
        JOIN group_members gm ON g.id = gm.group_id
        WHERE gm.user_id = ?
        ORDER BY last_message_time DESC
      `, [userId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  },

  joinGroup: (groupId, userId) => {
    return new Promise((resolve, reject) => {
      db.run('INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)',
        [groupId, userId, 'member'],
        function (err) {
          if (err) reject(err);
          else resolve({ success: true });
        }
      );
    });
  },

  getGroupMessages: (groupId, limit = 50) => {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT gm.*, u.username as sender_username
        FROM group_messages gm
        JOIN users u ON gm.sender_id = u.id
        WHERE gm.group_id = ?
        ORDER BY gm.created_at ASC
        LIMIT ?
      `, [groupId, limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  },

  createGroupMessage: (groupId, senderId, content, type = 'text') => {
    return new Promise((resolve, reject) => {
      const id = uuidv4();
      const createdAt = new Date().toISOString();
      db.run(
        'INSERT INTO group_messages (id, group_id, sender_id, content, type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, groupId, senderId, content, type, createdAt],
        function (err) {
          if (err) reject(err);
          else resolve({ id, groupId, senderId, content, type, createdAt });
        }
      );
    });
  },

  getGroupMembers: (groupId) => {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT u.id, u.username, u.avatar, u.status, gm.role
        FROM group_members gm
        JOIN users u ON gm.user_id = u.id
        WHERE gm.group_id = ?
      `, [groupId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }
};

module.exports = { db, dbHelpers };
