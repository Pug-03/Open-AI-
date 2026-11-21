# Voice features in Walk We

Walk We computes routes, shadow coverage and night scores on the device. The route explanation uses those same results to compare the selected route with the shortest route.

## Dictating a place name

The microphone fills the place search field using the browser's Web Speech API. The browser or its vendor may process the audio. Typing is available on browsers without speech recognition.

## Reading directions aloud

The browser can read localized instructions and arrival messages aloud. Sites that configure the optional ElevenLabs Worker send up to 300 characters of the text to be read and its language to `POST /speak`. The Worker returns MP3 audio, which the app caches in memory for the session. The browser voice is used when hosted speech is unavailable. The SOS countdown uses the browser voice.

The ElevenLabs key lives in the Worker secret `ELEVENLABS_API_KEY`. The Worker checks the site's origin, limits requests and leaves request text out of its logs. See [README](README.md#optional-hosted-speech) for configuration.
