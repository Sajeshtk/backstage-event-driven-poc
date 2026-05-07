import express from 'express';
import Router from 'express-promise-router';
import axios from 'axios';

export async function createRouter(): Promise<express.Router> {

  const router = Router();

  router.use(express.json());

  const RABBITMQ_API = 'http://localhost:15672/api';

  const auth = {
    username: 'guest',
    password: 'guest',
  };

  // =========================================================
  // GET all RabbitMQ topics (topic exchanges)
  // =========================================================
  router.get('/topics', async (_req, res) => {

    try {

      const response = await axios.get(
        `${RABBITMQ_API}/exchanges`,
        { auth },
      );

      const topics = response.data
        .filter(
          (e: any) =>
            e.type === 'topic' &&
            !e.name.startsWith('amq.'),
        )
        .map((e: any) => ({
          name: e.name,
          type: e.type,
          durable: e.durable,
          auto_delete: e.auto_delete,
          internal: e.internal,
          vhost: e.vhost,
        }));

      res.json({
        message: 'RabbitMQ topics fetched successfully',
        count: topics.length,
        data: topics,
      });

    } catch (error) {

      console.error('Failed to fetch topics:', error);

      res.status(500).json({
        error: 'Failed to fetch topics',
      });
    }
  });

  // =========================================================
  // GET catalog compatible resources (JSON)
  // =========================================================
  router.get('/catalog-resources', async (_req, res) => {

    try {

      const response = await axios.get(
        `${RABBITMQ_API}/exchanges`,
        { auth },
      );

      const resources = response.data
        .filter(
          (e: any) =>
            e.type === 'topic' &&
            !e.name.startsWith('amq.'),
        )
        .map((e: any) => ({

          apiVersion: 'backstage.io/v1alpha1',

          kind: 'Resource',

          metadata: {
            name: e.name.toLowerCase(),
            description: `RabbitMQ topic ${e.name}`,
          },

          spec: {
            type: 'rabbitmq-topic',
            owner: 'guest',
            lifecycle: 'production',
          },

        }));

      res.json(resources);

    } catch (error) {

      console.error('Failed to fetch catalog resources:', error);

      res.status(500).json({
        error: 'Failed to fetch catalog resources',
      });
    }
  });

  // =========================================================
  // Dynamic catalog-info.yaml for Backstage Catalog ingestion
  // =========================================================
  router.get('/catalog-info.yaml', async (_req, res) => {

    try {

      const response = await axios.get(
        `${RABBITMQ_API}/exchanges`,
        { auth },
      );

      const topics = response.data.filter(
        (e: any) =>
          e.type === 'topic' &&
          !e.name.startsWith('amq.'),
      );

      const yaml = topics.map((e: any) => `
apiVersion: backstage.io/v1alpha1
kind: Resource
metadata:
  name: ${e.name.toLowerCase()}
  description: RabbitMQ topic ${e.name}

spec:
  type: rabbitmq-topic
  owner: guest
  lifecycle: production
`).join('\n---\n');

      res.setHeader('Content-Type', 'text/yaml');

      res.send(yaml);

    } catch (error) {

      console.error('Failed to generate catalog YAML:', error);

      res.status(500).send(
        'Failed to generate catalog YAML',
      );
    }
  });

  // =========================================================
  // GET topic details
  // =========================================================
  router.get('/topics/:name', async (req, res) => {

    try {

      const { name } = req.params;

      const response = await axios.get(
        `${RABBITMQ_API}/exchanges/%2F/${name}`,
        { auth },
      );

      const exchange = response.data;

      res.json({
        message: 'Topic details fetched successfully',

        data: {
          name: exchange.name,
          type: exchange.type,
          durable: exchange.durable,
          auto_delete: exchange.auto_delete,
          internal: exchange.internal,
          arguments: exchange.arguments,
          vhost: exchange.vhost,
        },
      });

    } catch (error) {

      console.error('Failed to fetch topic details:', error);

      res.status(500).json({
        error: 'Failed to fetch topic details',
      });
    }
  });

  // =========================================================
  // Health endpoint
  // =========================================================
  router.get('/health', (_req, res) => {

    res.json({
      status: 'ok',
      plugin: 'event-plugin-backend',
    });
  });

  return router;
}