import amqp from 'amqplib';

const QUEUE = 'event-queue';

export const processedEvents: any[] = [];

export const startConsumer = async () => {
  try {
    const connection = await amqp.connect('amqp://localhost');
    const channel = await connection.createChannel();

    await channel.assertQueue(QUEUE);  

    console.log('Consumer started and waiting for messages');

    channel.consume(QUEUE, (msg) => {
      if (msg) {
        const content = msg.content.toString();
        console.log('Received message:', content);

        // Delay processing by 10 seconds
        setTimeout(() => {
          const data = JSON.parse(content);

          processedEvents.push({
            ...data,
            status: 'PROCESSED',
            processedAt: new Date(),
          });

          console.log('Message processed after 10 seconds');

          channel.ack(msg);
        }, 10000);
      }
    });
  } catch (error) {
    console.error('Error in consumer:', error);
  }
};