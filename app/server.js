const http = require('http');
const eetase = require('eetase');
const socketClusterServer = require('socketcluster-server');
const express = require('express');
const serveStatic = require('serve-static');
const path = require('path');
const morgan = require('morgan');
const uuid = require('uuid');
const sccBrokerClient = require('scc-broker-client');

const ENVIRONMENT = process.env.ENV || 'dev';
const SOCKETCLUSTER_PORT = process.env.SOCKETCLUSTER_PORT || 8000;
const SOCKETCLUSTER_WS_ENGINE = process.env.SOCKETCLUSTER_WS_ENGINE || 'ws';
const SOCKETCLUSTER_SOCKET_CHANNEL_LIMIT = Number(process.env.SOCKETCLUSTER_SOCKET_CHANNEL_LIMIT) || 1000;
const SOCKETCLUSTER_LOG_LEVEL = process.env.SOCKETCLUSTER_LOG_LEVEL || 2;

const SCC_INSTANCE_ID = uuid.v4();
const SCC_STATE_SERVER_HOST = process.env.SCC_STATE_SERVER_HOST || null;
const SCC_STATE_SERVER_PORT = process.env.SCC_STATE_SERVER_PORT || null;
const SCC_MAPPING_ENGINE = process.env.SCC_MAPPING_ENGINE || null;
const SCC_CLIENT_POOL_SIZE = process.env.SCC_CLIENT_POOL_SIZE || null;
const SCC_AUTH_KEY = process.env.SCC_AUTH_KEY || null;
const SCC_INSTANCE_IP = process.env.SCC_INSTANCE_IP || null;
const SCC_INSTANCE_IP_FAMILY = process.env.SCC_INSTANCE_IP_FAMILY || null;
const SCC_STATE_SERVER_CONNECT_TIMEOUT = Number(process.env.SCC_STATE_SERVER_CONNECT_TIMEOUT) || null;
const SCC_STATE_SERVER_ACK_TIMEOUT = Number(process.env.SCC_STATE_SERVER_ACK_TIMEOUT) || null;
const SCC_STATE_SERVER_RECONNECT_RANDOMNESS = Number(process.env.SCC_STATE_SERVER_RECONNECT_RANDOMNESS) || null;
const SCC_PUB_SUB_BATCH_DURATION = Number(process.env.SCC_PUB_SUB_BATCH_DURATION) || null;
const SCC_BROKER_RETRY_DELAY = Number(process.env.SCC_BROKER_RETRY_DELAY) || null;

let agOptions = {};

if (process.env.SOCKETCLUSTER_OPTIONS) {
  let envOptions = JSON.parse(process.env.SOCKETCLUSTER_OPTIONS);
  Object.assign(agOptions, envOptions);
}

let httpServer = eetase(http.createServer());
let agServer = socketClusterServer.attach(httpServer, agOptions);

let expressApp = express();
if (ENVIRONMENT === 'dev') {
  // Log every HTTP request. See https://github.com/expressjs/morgan for other
  // available formats.
  expressApp.use(morgan('dev'));
}
expressApp.use(serveStatic(path.resolve(__dirname, 'public')));

// Add GET /health-check express route
expressApp.get('/health-check', (req, res) => {
  res.status(200).send('OK');
});

// HTTP request handling loop.
(async () => {
  for await (let requestData of httpServer.listener('request')) {
    expressApp.apply(null, requestData);
  }
})();



bindMiddleware(agServer);

var count = 0;
// SocketCluster/WebSocket connection handling loop.
(async () => {
  for await (let {socket} of agServer.listener('connection')) {
    // Handle socket connection.

    count++;
    agServer.exchange.transmitPublish('secure', 'connected [' + count + ']>> ' + socket.id);



    (async () => {
      // Set up a loop to handle and respond to RPCs.
      for await (let request of socket.procedure('customProc')) {
        if (request.data && request.data.bad) {
          let badCustomError = new Error('Server failed to execute the procedure');
          badCustomError.name = 'BadCustomError';
          request.error(badCustomError);
          continue;
        }
        request.end('Success');
      }
    })();

    (async () => {
      // Set up a loop to handle and respond to RPCs.
      for await (let request of socket.procedure('foo')) {
        console.log('foorpc called');
        if (request.data && request.data.bad) {
          let badCustomError = new Error('Server failed to execute the procedure');
          badCustomError.name = 'BadCustomError';
          request.error(badCustomError);
          continue;
        }
        request.end('Success');
      }
    })();


    (async () => {
      // Set up a loop to handle remote transmitted events.
      for await (let data of socket.receiver('customRemoteEvent')) {
        // ...
        console.log('rpc >> ' + data);

      }
    })();


    (async () => {
      // Set up a loop to handle remote transmitted events.
      for await (let data of socket.receiver('push')) {
        // ...
        console.log('push foo  >> ' + data.foo);

      }
    })();


  }
})();

httpServer.listen(SOCKETCLUSTER_PORT);

if (SOCKETCLUSTER_LOG_LEVEL >= 1) {
  (async () => {
    for await (let {error} of agServer.listener('error')) {
      console.error(error);
    }
  })();
}

if (SOCKETCLUSTER_LOG_LEVEL >= 2) {
  console.log(
    `   ${colorText('[Active]', 32)} SocketCluster worker with PID ${process.pid} is listening on port ${SOCKETCLUSTER_PORT}`
  );

  (async () => {
    for await (let {warning} of agServer.listener('warning')) {
      console.warn(warning);
    }
  })();
}

function colorText(message, color) {
  if (color) {
    return `\x1b[${color}m${message}\x1b[0m`;
  }
  return message;
}

if (SCC_STATE_SERVER_HOST) {
  // Setup broker client to connect to SCC.
  let sccClient = sccBrokerClient.attach(agServer.brokerEngine, {
    instanceId: SCC_INSTANCE_ID,
    instancePort: SOCKETCLUSTER_PORT,
    instanceIp: SCC_INSTANCE_IP,
    instanceIpFamily: SCC_INSTANCE_IP_FAMILY,
    pubSubBatchDuration: SCC_PUB_SUB_BATCH_DURATION,
    stateServerHost: SCC_STATE_SERVER_HOST,
    stateServerPort: SCC_STATE_SERVER_PORT,
    mappingEngine: SCC_MAPPING_ENGINE,
    clientPoolSize: SCC_CLIENT_POOL_SIZE,
    authKey: SCC_AUTH_KEY,
    stateServerConnectTimeout: SCC_STATE_SERVER_CONNECT_TIMEOUT,
    stateServerAckTimeout: SCC_STATE_SERVER_ACK_TIMEOUT,
    stateServerReconnectRandomness: SCC_STATE_SERVER_RECONNECT_RANDOMNESS,
    brokerRetryDelay: SCC_BROKER_RETRY_DELAY
  });

  if (SOCKETCLUSTER_LOG_LEVEL >= 1) {
    (async () => {
      for await (let {error} of sccClient.listener('error')) {
        error.name = 'SCCError';
        console.error(error);
      }
    })();
  }
}


function bindMiddleware(agServer) {

  /** ORDER
   middleware MIDDLEWARE_HANDSHAKE handshakeWS 1
   middleware MIDDLEWARE_INBOUND_RAW message 2
   middleware MIDDLEWARE_HANDSHAKE handshakeSC 3
   middleware MIDDLEWARE_INBOUND_RAW message 2
   middleware MIDDLEWARE_INBOUND subscribe 4
   middleware MIDDLEWARE_INBOUND_RAW message 2
   middleware MIDDLEWARE_INBOUND invoke 5
   customProc end
   middleware MIDDLEWARE_OUTBOUND publishOut
   middleware MIDDLEWARE_OUTBOUND publishOut
   middleware MIDDLEWARE_INBOUND_RAW message
   middleware MIDDLEWARE_INBOUND publishIn
   middleware MIDDLEWARE_OUTBOUND publishOut
   **/

  agServer.setMiddleware(agServer.MIDDLEWARE_HANDSHAKE, async (middlewareStream) => {
    for await (let action of middlewareStream) {

      // console.log("\t<<0>>");


      if (action.type === action.HANDSHAKE_WS) {
        // console.log("\t<<0.A>>");
        // console.log('HANDSHAKE_WS [type,request]: ' , action.request.headers , action.request.rawHeaders);
        // console.log('We can read/set a header here - or - based on cookie we can set header ? ');


        // if (!action.data) {
        //   let error = new Error(
        //       'Transmit action must have a data object'
        //   );
        //   error.name = 'InvalidActionError';
        //   action.block(error);
        //   continue;
        // }
      }

      if (action.type === action.HANDSHAKE_SC) {
        // console.log("\t<<0.B>>");
        // console.log('HANDSHAKE_SC [type,request,socket]' + action.socket.id);
        // console.log('We can prevent the socket connection from starting to the server it we wanted to  ');
        // if (!action.data) {
        //   let error = new Error(
        //       'Transmit action must have a data object'
        //   );
        //   error.name = 'InvalidActionError';
        //   action.block(error);
        //   continue;
        // }
      }

      // console.log('middleware MIDDLEWARE_HANDSHAKE ' + action.type + ' ' + action.request + ' ' + action.data);
      action.allow();
    }
  });

  agServer.setMiddleware(agServer.MIDDLEWARE_INBOUND, async (middlewareStream) => {
    for await (let action of middlewareStream) {

      let allowed = true;

      if (action.type === action.TRANSMIT) {
        // console.log('inbound 1 >> MIDDLEWARE_INBOUND TRANSMIT');
      }

      if (action.type === action.INVOKE) {
        console.log('inbound 2 >> MIDDLEWARE_INBOUND INVOKE');
      }

      if (action.type === action.SUBSCRIBE) {
        // console.log('inbound 3 >> MIDDLEWARE_INBOUND SUBSCRIBE');
      }

      if (action.type === action.PUBLISH_IN) {
        // console.log('inbound 4 >> MIDDLEWARE_INBOUND PUBLISH_IN');

        console.log("* * publishing in " , JSON.stringify(action.socket.authToken));

        if(action.socket.authState!=="authenticated"){
          console.log("not authenticated - denied publish in");
          // action.block();
          // allowed = false;

        } else {

          //is already authenticated
          let authToken = action.socket.authToken;
          console.log("is authenticated: " + action.socket.authToke!=null)
        }




        //TODO: This is where we can put ground control....
        // var token = action.socket.authToken;
        // if(token!=null)
        // {
        //   console.log("PUBLISH IN >> token is not null >> " + token.username + " " + action.socket.authState);//TODO: DO I HAVE THE RIGHT TO PUBLISH IN >> PUBLISH OUT?
        //
        // }


      }

      if (action.type === action.AUTHENTICATE) {
        // console.log('inbound 5 >> MIDDLEWARE_INBOUND AUTHENTICATE');
      }


      console.log('middleware MIDDLEWARE_INBOUND ' + action.type + ' ' + action.request + ' ' + action.data + action.channel);


      if(action.type ==='subscribe')
      {
        console.log('subscribe request to ' + action.channel);
        agServer.exchange.transmitPublish('secure', '*> user join channel request to: ' + action.channel);
      }

      if(allowed)
      {
        console.log("raw action allowed");
        action.allow();
      }

    }
  });

  agServer.setMiddleware(agServer.MIDDLEWARE_INBOUND_RAW, async (middlewareStream) => {
    for await (let action of middlewareStream) {
      // if (action.type === action.MESSAGE) {
      //   // console.log('raw >> middleware MIDDLEWARE_INBOUND_RAW ACTION ' , action);
      //   console.log('raw >> action ended ' + action.type);
      //   console.log('raw data' + action.data);
      //   // console.log('raw >> middleware MIDDLEWARE_INBOUND_RAW ' + action.type + ' ' + action.request + ' ' + action.data + " " , action);
      //
      //   if(action.socket.authToken!=null && action.data=="deauthenticate")
      //   {
      //     action.allow();
      //   } else {
      //     console.log("Message action denied - unauthorized")
      //   }
      //
      // } else {
      //   //INCOMING RAW - NOT MESSAGE
      //   action.allow();
      // }



      action.allow();
    }
  });

  agServer.setMiddleware(agServer.MIDDLEWARE_OUTBOUND, async (middlewareStream) => {
    for await (let action of middlewareStream) {

      console.log('<< middleware MIDDLEWARE_OUTBOUND type: ' + action.type + ' id: ' + action.socket.id + ' data: ' + action.data);


      //
      // /** THIS IS THE SPOT WHERE WE CONTROL GOING OUT - CLEAN MESSAGES  ! ! ! SECURITY **/
      // //TODO: Sanitize on the way out to the workers
      // //TODO: THIS WORKS BUT CAN BE IMPROVED - I SUGGEST USING domPurify
      // try{
      //
      //   //TODO: handle JSON exceptions better than this try catch
      //   let data = JSON.parse(action.data);
      //   console.log('middleware incoming action: '+ ation.type);
      //
      //
      //   /** Here we can control actions **/
      //
      //   if(action.type=="circle"){
      //     console.log("outbound circle data: " + data.text);
      //   }
      //
      //
      //
      //
      //
      //
      //
      //   var XSS = false;
      //   if(XSS===true)
      //   {
      //
      //     //THIS BLOCKS ALL SCRIPT
      //     // var clean = DOMPurify.sanitize(JSON.stringify(data), {FORBID_TAGS: ['script']});
      //
      //
      //     //THIS IS SAFER - BLOCKS ALL FOR .HTML()
      //     var clean = DOMPurify.sanitize(data.text, {SAFE_FOR_JQUERY: true});
      //
      //     console.log('blocked :)');
      //     action.data = clean;
      //     // action.block();
      //
      //
      //
      //
      //
      //
      //   }
      // }catch (err){
      //
      //   //console.log(" ! error : " + err.message);
      // }

      // if(jsonObject.data==="hi")
      // {
      //   console.log('XSS warning!');
      //   action.block();
      // }
      action.allow();
    }
  });

}

