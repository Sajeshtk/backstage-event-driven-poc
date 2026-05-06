import React, { useState } from 'react';
import { Header, Container } from '@backstage/ui';

export const TodoPage = () => {
  const [events, setEvents] = useState<any[]>([]);

  const BASE_URL = 'http://localhost:7007/api/event-plugin';

  // POST API - Send Event
  const sendEvent = async () => {
    console.log('Send Event clicked');

    try {
      const res = await fetch(`${BASE_URL}/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'OrderCreated',
          amount: 100,
        }),
      });

      console.log('POST status:', res.status);

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.message || 'Failed to send event');
      }

      console.log('POST response:', data);
      alert('Event sent successfully');
    } catch (error: any) {
      console.error('Error sending event:', error);
      alert(`Error sending event: ${error.message}`);
    }
  };

  // GET API - Fetch Processed Events
  const fetchEvents = async () => {
    console.log('Fetch Events clicked');

    try {
      const res = await fetch(`${BASE_URL}/events`);

      console.log('GET status:', res.status);

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.message || 'Failed to fetch events');
      }

      console.log('GET response:', data);

      setEvents(data.data || []);
    } catch (error: any) {
      console.error('Error fetching events:', error);
      alert(`Error fetching events: ${error.message}`);
    }
  };

  return (
    <>
      <Header title="Event Driven Demo" />
      <Container>
        <div style={{ marginBottom: 20 }}>
          <button onClick={sendEvent}>Send Event</button>

          <button onClick={fetchEvents} style={{ marginLeft: 10 }}>
            Fetch Events
          </button>
        </div>

        <h3>Processed Events</h3>

        <table border={1} cellPadding={10}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Processed Time</th>
            </tr>
          </thead>
          <tbody>
            {events.length > 0 ? (
              events.map((e, i) => (
                <tr key={i}>
                  <td>{e.name}</td>
                  <td>{e.amount}</td>
                  <td>{e.status || 'Processed'}</td>
                  <td>{e.processedAt || new Date().toLocaleString()}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center' }}>
                  No events found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Container>
    </>
  );
};