cd app
npm install --legacy-peer-deps

# Apply the URL factory modification for HTTP
# (Copy the modified urlFactory.js content above)

npm run build

# Move built files to server public directory
rm -rf ../server/public
mv dist ../server/public
cd ../server

npm install

./start.sh
