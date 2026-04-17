# Docker on Raspberry Pi

## 1) Build and run on the Pi

```bash
cd /path/to/wavelength
docker build -t wavelength:pi .
docker run -d --name wavelength --restart unless-stopped -p 8080:80 wavelength:pi
```

Open: `http://<PI_IP>:8080`

## 2) Run with Docker Compose

```bash
cd /path/to/wavelength
docker compose up -d --build
```

Open: `http://<PI_IP>:8080`

## 3) Optional: build multi-arch image from another machine

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t <your-dockerhub-user>/wavelength:latest \
  --push .
```

Then on Pi:

```bash
docker run -d --name wavelength --restart unless-stopped -p 8080:80 <your-dockerhub-user>/wavelength:latest
```
