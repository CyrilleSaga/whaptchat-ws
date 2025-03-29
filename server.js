import {WebSocketServer} from 'ws'
import jwt from "jsonwebtoken";
import {prisma} from "./prisma.js";
import express from "express";

const PORT = process.env.PORT || 3000;

const app = express()
const server = app.listen(PORT, () => {
    console.log(`✅ WebSocket Server running on port ${PORT}`);
})

const wss = new WebSocketServer({server});

// Save logged-in users
const clients = new Map()

wss.on('connection', async (ws, request) => {

    try {

        // Get JWT token from query params
        const token = new URL(request.url, `http://${request.headers.host}`).searchParams.get('token');

        // Verify token
        let user
        try {
            user = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            ws.close()
            console.error("Error:" + err)
            return
        }

        // Save user
        clients.set(ws, user)

        // Connexion à la base de données
        await prisma.$connect();

        // Envoi des messages précédents
        const messages = await prisma.message.findMany({
            select: {content: true, createdAt: true, user: {select: {username: true}}},
            orderBy: {createdAt: 'asc'}
        });

        messages.forEach(message => {
            ws.send(JSON.stringify({
                username: message.user.username,
                content: message.content,
                createdAt: message.createdAt
            }));
        })

        // Réception des messages
        ws.on('message', async (message) => {
            try {
                const parsedMessage = JSON.parse(message);

                // Sauvegarder le message en base
                const newMessage = await prisma.message.create({
                    data: {userId: user.userId, content: parsedMessage.content}
                });

                // Diffuser le message à tous les clients connectés
                const dataToSend = JSON.stringify({
                    username: user.username,
                    content: parsedMessage.content,
                    createdAt: newMessage.createdAt
                });

                clients.forEach((client, clientWs) => {
                    if (clientWs.readyState === ws.OPEN) {
                        clientWs.send(dataToSend);
                    }
                });
            } catch (error) {
                console.error("❌ Error processing message:", error.message);
            }
        });

        // Déconnexion
        ws.on('close', () => {
            clients.delete(ws);
            console.log(`❌ User disconnected: ${user.username}`);
        });

    } catch (error) {
        console.error("❌ Connection error:", error.message);
        ws.close();
    }

})
