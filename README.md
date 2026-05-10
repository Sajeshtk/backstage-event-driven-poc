# [Backstage](https://backstage.io)

This is your newly scaffolded Backstage App, Good Luck!

To start the app, run:

```sh
yarn install
yarn start
```


```shell

  curl -s -u guest:guest -X PUT http://localhost:15672/api/exchanges/%2F/orders.events \
    -d '{"type":"topic","durable":true}'

  This creates a topic exchange called orders.events. Once created, refresh http://localhost:3000/event and it should appear in the list.

  You can create more with different names to simulate a real setup:

  curl -s -u guest:guest -X PUT http://localhost:15672/api/exchanges/%2F/payments.events \
    -H "Content-Type: application/json" \
    -d '{"type":"topic","durable":true}'

  curl -s -u guest:guest -X PUT http://localhost:15672/api/exchanges/%2F/inventory.updates \
    -H "Content-Type: application/json" \
    -d '{"type":"topic","durable":true}'

```