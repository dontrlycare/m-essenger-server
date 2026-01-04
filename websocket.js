const WebSocket = require('ws');
const { dbHelpers } = require('./database');

// Store active connections
const connections = new Map(); // Map<userId, WebSocket>

function setupWebSocket(server) {
    const wss = new WebSocket.Server({ server });

    wss.on('connection', (ws) => {
        let userId = null;

        ws.on('message', async (data) => {
            try {
                const message = JSON.parse(data);

                switch (message.type) {
                    case 'auth':
                        // Authenticate and store connection
                        userId = message.userId;
                        connections.set(userId, ws);
                        await dbHelpers.updateUserStatus(userId, 'online');

                        // Notify all users about online status
                        broadcastStatus(userId, 'online');

                        ws.send(JSON.stringify({ type: 'auth_success' }));
                        break;

                    case 'message':
                        // Handle new message
                        const newMessage = await dbHelpers.createMessage(
                            message.conversationId,
                            message.senderId,
                            message.content,
                            message.messageType || 'text'
                        );

                        // Get conversation participants
                        const participants = await dbHelpers.getConversationParticipants(message.conversationId);

                        // Get sender info
                        const sender = await dbHelpers.getUserById(message.senderId);

                        // Send message to all participants
                        participants.forEach(participantId => {
                            const participantWs = connections.get(participantId);
                            if (participantWs && participantWs.readyState === WebSocket.OPEN) {
                                participantWs.send(JSON.stringify({
                                    type: 'new_message',
                                    message: {
                                        ...newMessage,
                                        sender_username: sender.username
                                    }
                                }));
                            }
                        });
                        break;

                    case 'typing':
                        // Handle typing indicator
                        const typingParticipants = await dbHelpers.getConversationParticipants(message.conversationId);
                        typingParticipants.forEach(participantId => {
                            if (participantId !== message.userId) {
                                const participantWs = connections.get(participantId);
                                if (participantWs && participantWs.readyState === WebSocket.OPEN) {
                                    participantWs.send(JSON.stringify({
                                        type: 'typing',
                                        conversationId: message.conversationId,
                                        userId: message.userId,
                                        isTyping: message.isTyping
                                    }));
                                }
                            }
                        });
                        break;

                    // WebRTC Signaling
                    case 'call_offer':
                        // Forward call offer to target user
                        const targetWs = connections.get(message.targetUserId);
                        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                            targetWs.send(JSON.stringify({
                                type: 'call_offer',
                                offer: message.offer,
                                callerId: message.callerId,
                                callerName: message.callerName,
                                conversationId: message.conversationId,
                                isVideo: message.isVideo
                            }));
                        } else {
                            // User offline
                            ws.send(JSON.stringify({
                                type: 'call_error',
                                error: 'User is offline'
                            }));
                        }
                        break;

                    case 'call_answer':
                        // Forward call answer
                        const callerWs = connections.get(message.callerId);
                        if (callerWs && callerWs.readyState === WebSocket.OPEN) {
                            callerWs.send(JSON.stringify({
                                type: 'call_answer',
                                answer: message.answer,
                                answererId: message.answererId
                            }));
                        }
                        break;

                    case 'ice_candidate':
                        // Forward ICE candidate
                        const peerWs = connections.get(message.targetUserId);
                        if (peerWs && peerWs.readyState === WebSocket.OPEN) {
                            peerWs.send(JSON.stringify({
                                type: 'ice_candidate',
                                candidate: message.candidate,
                                fromUserId: message.fromUserId
                            }));
                        }
                        break;

                    case 'call_end':
                        // Notify about call end
                        const endTargetWs = connections.get(message.targetUserId);
                        if (endTargetWs && endTargetWs.readyState === WebSocket.OPEN) {
                            endTargetWs.send(JSON.stringify({
                                type: 'call_ended',
                                fromUserId: message.fromUserId
                            }));
                        }
                        break;

                    case 'call_reject':
                        // Notify about call rejection
                        const rejectCallerWs = connections.get(message.callerId);
                        if (rejectCallerWs && rejectCallerWs.readyState === WebSocket.OPEN) {
                            rejectCallerWs.send(JSON.stringify({
                                type: 'call_rejected',
                                rejecterId: message.rejecterId
                            }));
                        }
                        break;
                }
            } catch (error) {
                console.error('WebSocket message error:', error);
                ws.send(JSON.stringify({ type: 'error', error: error.message }));
            }
        });

        ws.on('close', async () => {
            if (userId) {
                connections.delete(userId);
                await dbHelpers.updateUserStatus(userId, 'offline');
                broadcastStatus(userId, 'offline');
            }
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
        });
    });

    function broadcastStatus(userId, status) {
        connections.forEach((ws, id) => {
            if (id !== userId && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'user_status',
                    userId: userId,
                    status: status
                }));
            }
        });
    }

    return wss;
}

module.exports = { setupWebSocket };
