# ProtoScribe Glasses Setup

This guide explains how to set up the Even Realities G2 glasses and connect them to your development machine for ProtoScribe testing.

## Connection model

The glasses do not connect directly to your PC.

Use this path instead:

`PC dev server/backend -> iPhone Even App -> Bluetooth -> G2 glasses`

That means you need:

- G2 glasses paired to the iPhone
- iPhone and PC on the same Wi-Fi network
- ProtoScribe frontend and backend running on the PC

## What you need

- Even Realities G2 smart glasses
- iPhone with the Even app installed
- Mac or PC running ProtoScribe
- Same local Wi-Fi network for phone and computer
- Bluetooth enabled on the iPhone
- Charged glasses

## 1. Pair the glasses

1. Turn on the G2 glasses.
2. Open the Even app on the iPhone.
3. Follow the Even app pairing flow to connect the glasses over Bluetooth.
4. Confirm the glasses appear as connected in the Even app.
5. Verify the glasses can show their normal system UI before testing ProtoScribe.

## 2. Start ProtoScribe on your computer

Run the frontend from the project folder:

```bash
cd /Users/bellz_um/Desktop/freely/protoscribe
npm run dev -- --host 0.0.0.0
```

Run the backend in another terminal:

```bash
cd /Users/bellz_um/Desktop/freely/protoscribe
source .venv/bin/activate
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

## 3. Find your computer's local IP

On macOS, run:

```bash
ipconfig getifaddr en0
```

If needed, try:

```bash
ipconfig getifaddr en1
```

Example result:

```text
192.168.1.25
```

## 4. Point ProtoScribe to your backend

Update `.env.local` so the iPhone can reach the backend on your computer:

```env
VITE_API_BASE_URL=http://192.168.1.25:8000
VITE_STT_PROVIDER=browser
VITE_STT_LANGUAGE=en-US
```

Replace `192.168.1.25` with your real local IP.

After changing `.env.local`, restart the Vite server.

## 5. Open the app on the phone and glasses

Use the Even Hub QR flow:

```bash
npx evenhub qr --url http://192.168.1.25:5173
```

Replace the IP with your actual local IP.

Then:

1. Scan the QR code from the Even app.
2. Let the Even app open ProtoScribe on the phone.
3. The phone relays the display and input to the glasses.

## 6. Confirm the setup works

Once the app is open:

- The phone should show the ProtoScribe companion UI
- The glasses should show the startup or current step screen

Try these commands:

- `start session`
- `next`
- `note media looked cloudy`

If voice control fails, use temple double-tap to advance to the next step.

## Recommended testing order

First test in the simulator:

```bash
npx evenhub-simulator http://localhost:5173
```

Then move to real-device testing after the local UI works.

## Common issues

### Phone cannot load the app

- Make sure the phone and computer are on the same Wi-Fi network.
- Make sure you started both servers with `--host 0.0.0.0`.
- Check that macOS firewall is not blocking ports `5173` and `8000`.

### Frontend loads but backend actions fail

- `VITE_API_BASE_URL` is probably still pointing to `localhost`.
- Change it to your computer's LAN IP and restart the frontend server.

### Glasses show nothing

- Confirm the Even app is connected to the glasses over Bluetooth.
- Confirm the app was launched through the Even flow, not just opened in Safari.

### Voice works in browser but not on device

- Check microphone permissions in the Even app.
- Start with `VITE_STT_PROVIDER=browser` for the simplest test path.

### QR opens but the page is blank

- Restart the frontend and backend.
- Generate the QR code again using the correct IP.
- Test the backend directly from the phone browser:

```text
http://192.168.1.25:8000/api/health
```

## Recommended first real-device setup

- Use `browser` STT first
- Run frontend and backend on the same machine
- Use your computer's LAN IP in `.env.local`
- Pair glasses to the iPhone first
- Launch through:

```bash
npx evenhub qr --url http://<your-local-ip>:5173
```

## Quick mental model

- PC: serves the web app and backend
- iPhone: runtime bridge
- Glasses: display and input endpoint
