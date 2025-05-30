import {io} from 'socket.io-client';

const socket = io({
});

socket.on('connect',() => {
    console.log('Socket connected! socketid: ',socket.id);
});

socket.on('connect_error', (err) => {
  console.error('Socket connection error:', err.message, err.data);
});

socket.on('disconnect', (reason) => {
  console.log('Socket disconnected from signaling server:', reason);
});


export default socket;