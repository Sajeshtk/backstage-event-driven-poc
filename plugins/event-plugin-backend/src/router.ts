import express from 'express';
import Router from 'express-promise-router';
import amqp from 'amqplib';
import { processedEvents } from './Consumer';

export async function createRouter(): Promise<express.Router> {
  const router = Router();
  router.use(express.json());

  const queue = 'event-queue';

  // POST API → Producer
  router.post('/event', async (req, res) => {
    const event = req.body;

    // Create connection only when needed
    const connection = await amqp.connect('amqp://localhost');
    const channel = await connection.createChannel();

    await channel.assertQueue(queue);

    channel.sendToQueue(queue, Buffer.from(JSON.stringify(event)));

    console.log('Event sent to queue:', event);

    res.json({
      message: 'Event sent to RabbitMQ',
      data: event,
    });
  });

  // GET API → Fetch processed events
  router.get('/events', (_req, res) => {
    res.json({
      message: 'Processed events fetched',
      data: processedEvents,
    });
  });

  // Health check
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  return router;
}