import {createServer} from 'http';
import crypto from 'crypto';
import { Socket } from 'dgram';

const PORT = 3000;
const WEBSOCKET_MAGIC_STRING_KEY = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const SEVEN_BITS_INTEGER_MARKER = 125;
const SIXTEEN_BITS_INTEGER_MARKER = 126;
const SIXTYFOUR_BITS_INTEGER_MARKER = 127;

const MASK_KEY_BYTES_LENGTH = 4;

const sockets = {};

const server = createServer((request, response) => {
    response.writeHead(200);
    response.end('Hello World');
})
.listen(PORT, _ => console.log(`Server is listening to ${PORT}`));

server.on('upgrade', onSocketUpgrade);

function onSocketUpgrade(request, socket, head) {
    const {'sec-websocket-key': webClientSocketKey} = request.headers;
    console.log(`${webClientSocketKey} has connected.`);

    const headers = prepareHandShakeHeaders(webClientSocketKey);
    socket.write(headers);

    socket.on('readable', _ => onSocketReadable(socket, webClientSocketKey));
    socket.on('error', error => {
        delete sockets[webClientSocketKey];
        throw error;
    });

    sockets[webClientSocketKey] = socket;
}

function onSocketReadable(socket) {
    socket.read(1);

    const [markerAndPayloadLength] = socket.read(1);
    const lengthIndicator = markerAndPayloadLength - 0b10000000;

    let messageLength = 0;
    if (lengthIndicator <= SEVEN_BITS_INTEGER_MARKER) messageLength = lengthIndicator;
    else if (lengthIndicator == SIXTEEN_BITS_INTEGER_MARKER) messageLength = socket.read(2).readUint16BE(0);
    else throw new Error('Your message is too long to be read.');

    const maskKey = socket.read(MASK_KEY_BYTES_LENGTH);
    const encoded = socket.read(messageLength);
    const decoded = unmask(encoded, maskKey);
    const received = decoded.toString('utf8');
    
    console.log(`Message received: ${received}`);

    for (let i in sockets) sendMessage(received, sockets[i]);
}

function sendMessage(message, socket) {
    const data = prepareMessage(message);
    socket.write(data);
}

function prepareMessage(message) {
    const messageBuffer = Buffer.from(message);
    const messageSize = messageBuffer.length;
    const firstByte = 0b10000001;

    let dataFrameBuffer;

    if (messageSize <= SEVEN_BITS_INTEGER_MARKER) {
        const bytes = [firstByte];
        dataFrameBuffer = Buffer.from(bytes.concat(messageSize));
    } else if (messageSize <= SIXTEEN_BITS_INTEGER_MARKER) {
        const offset = 4;
        
        const target = Buffer.allocUnsafe(offset);
        target[0] = firstByte;
        target[1] = SIXTEEN_BITS_INTEGER_MARKER | 0x0;

        target.writeUint16BE(messageSize, 2);
        dataFrameBuffer = target;
    } else throw 'Your message is too long to be sent.';

    const dataFrameReponse = Buffer.concat([dataFrameBuffer, messageBuffer]);
    return dataFrameReponse;
}

function unmask(encodedBuffer, maskKey) {
    const finalBuffer = Buffer.from(encodedBuffer);

    for (let i = 0; i < encodedBuffer.length; i++)
        finalBuffer[i] = encodedBuffer[i] ^ maskKey[i % MASK_KEY_BYTES_LENGTH];

    return finalBuffer;
}

function prepareHandShakeHeaders(id) {
    const acceptKey = createSocketAccept(id);
    const headers = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey}`,
        ''
    ].map(line => line.concat('\r\n')).join('');

    return headers;
}

function createSocketAccept(id) {
    const sha1 = crypto.createHash('sha1');
    sha1.update(id + WEBSOCKET_MAGIC_STRING_KEY);
    return sha1.digest('base64');
}

[
    'uncaughtException',
    'unhandledRejection'
].forEach(event =>
    process.on(event, error => {
        console.error(`Error! Event: ${event},  Message: ${error.stack || error}`);
    })
);

setInterval(_ => console.log(Object.entries(sockets).length), 1000);