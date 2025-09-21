#!/bin/bash

# Set your server's internal IP address here
export MEDIASOUP_ANNOUNCED_IP="192.168.80.65"  # Replace with your server's IP
export MEDIASOUP_LISTEN_IP="0.0.0.0"
export PROTOO_LISTEN_PORT="4443"
export MEDIASOUP_MIN_PORT="40000"
export MEDIASOUP_MAX_PORT="49999"
export DEBUG="*mediasoup* *INFO* *WARN* *ERROR*"

echo "Starting mediasoup-demo server..."
echo "Server will be available at: http://$MEDIASOUP_ANNOUNCED_IP:$PROTOO_LISTEN_PORT"

node server.js