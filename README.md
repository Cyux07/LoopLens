<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1sJPOFkDvRYzeWNnXXlkOlTMwdKb3PQSj

## Run Locally

**Prerequisites:**  Node.js


1. ~~Install dependencies:~~
   `npm install`
2. ~~Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key~~
3. ~~Run the app:~~
   `npm run dev`

install node by docker:
```
docker pull node:24-alpine
```

build project:
```
docker build -t looplens:1.0 .
```

run container:
```
docker run -d -p 8080:80 --name="mylooplens" looplens:1.0
```


