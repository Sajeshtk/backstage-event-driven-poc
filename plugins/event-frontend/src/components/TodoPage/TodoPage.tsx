import React, { useEffect, useState } from 'react';
import { Header, Container } from '@backstage/ui';

export const TodoPage = () => {
  const [topics, setTopics] = useState<any[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<any>(null);

  const BASE_URL = 'http://localhost:7007/api/event-plugin';

  // Fetch all topics
  const fetchTopics = async () => {
    try {
      const res = await fetch(`${BASE_URL}/topics`);
      const data = await res.json();
      setTopics(data.data || []);
    } catch (error) {
      console.error('Error fetching topics:', error);
    }
  };

  // Fetch topic details
  const fetchTopicDetails = async (name: string) => {
    try {
      const res = await fetch(`${BASE_URL}/topics/${name}`);
      const data = await res.json();
      setSelectedTopic(data.data);
    } catch (error) {
      console.error('Error fetching topic details:', error);
    }
  };

  useEffect(() => {
    fetchTopics();
  }, []);

  return (
    <>
      <Header title="RabbitMQ Topics Dashboard" />
      <Container>
        <div style={{ display: 'flex', gap: '20px' }}>
          
          {/* LEFT SIDE - Topic List */}
          <div style={{ width: '30%' }}>
            <h3>Topics</h3>
            <ul>
              {topics.map((t, i) => (
                <li
                  key={i}
                  style={{ cursor: 'pointer', marginBottom: '10px' }}
                  onClick={() => fetchTopicDetails(t.name)}
                >
                  {t.name}
                </li>
              ))}
            </ul>
          </div>

          {/* RIGHT SIDE - Topic Details */}
          <div style={{ width: '70%' }}>
            <h3>Details</h3>

            {selectedTopic ? (
              <div>
                <p><strong>Name:</strong> {selectedTopic.name}</p>
                <p><strong>Durable:</strong> {selectedTopic.durable.toString()}</p>
                <p><strong>Messages:</strong> {selectedTopic.messages}</p>
                <p><strong>Consumers:</strong> {selectedTopic.consumers}</p>
              </div>
            ) : (
              <p>Select a topic to view details</p>
            )}
          </div>

        </div>
      </Container>
    </>
  );
};