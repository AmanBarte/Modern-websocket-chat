const fastify = require('fastify')({ logger: true });
const path = require('path');
const fs = require('fs').promises;

// Initialize data
let messageHistory = [];
let onlineUsers = new Set();

// Ensure messages.json exists
async function initMessageStorage() {
    try {
        await fs.access('messages.json');
    } catch {
        await fs.writeFile('messages.json', '[]');
    }
}

fastify.register(require('fastify-websocket'));
fastify.register(require('fastify-static'), {
    root: path.join(__dirname, 'www'),
    prefix: '/'
});

fastify.addHook('preValidation', async (request, reply) => {
    if (request.routerPath === '/chat' && !request.query.username) {
        reply.code(403).send('Connection rejected');
    }
});

fastify.get('/chat', { websocket: true }, (connection, req) => {
    const username = req.query.username;
    
    // Add user
    onlineUsers.add(username);
    broadcastUserList();

    // Send history
    connection.socket.send(JSON.stringify({
        type: 'history',
        messages: messageHistory.slice(-50)
    }));

    // Notify join
    broadcast({
        type: 'system',
        sender: '__server',
        message: `${username} joined`,
        timestamp: new Date().toISOString()
    });

    // Message handler
    connection.socket.on('message', async (message) => {
        try {
            const msg = JSON.parse(message.toString());
            const messageObj = {
                type: 'message',
                sender: username,
                message: msg.message,
                timestamp: new Date().toISOString()
            };

            messageHistory.push(messageObj);
            await fs.writeFile('messages.json', JSON.stringify(messageHistory));
            broadcast(messageObj);
        } catch (error) {
            fastify.log.error('Message error:', error);
        }
    });

    // Disconnect handler
    connection.socket.on('close', () => {
        onlineUsers.delete(username);
        broadcastUserList();
        broadcast({
            type: 'system',
            sender: '__server',
            message: `${username} left`,
            timestamp: new Date().toISOString()
        });
    });
});

// Start server
async function start() {
    try {
        await initMessageStorage();
        const data = await fs.readFile('messages.json', 'utf8');
        messageHistory = JSON.parse(data);
        
        await fastify.listen(5500);
        fastify.log.info(`Server running on ${fastify.server.address().port}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
}

function broadcast(message) {
    const payload = JSON.stringify(message);
    fastify.websocketServer.clients.forEach(client => {
        if (client.readyState === 1) {
            client.send(payload);
        }
    });
}

function broadcastUserList() {
    broadcast({
        type: 'userList',
        users: Array.from(onlineUsers),
        timestamp: new Date().toISOString()
    });
}

start();