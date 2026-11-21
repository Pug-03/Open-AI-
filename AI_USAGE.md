# Voice features in Walk We

Walk We computes routes, shadow coverage and night scores on the device. The route explanation uses those same results to compare the selected route with the shortest route.

## Dictating a place name

The microphone fills the place search field using the browser's Web Speech API. The browser or its vendor may process the audio. Typing is available on browsers without speech recognition.

## Reading directions aloud

The browser can read localized instructions and arrival messages aloud. When the OpenAI Worker is configured, the app sends up to 300 characters and the language to `POST /voice/live/speak`. The Worker returns audio only if its transcript matches the requested text. The browser voice is the fallback and reads the SOS countdown.

## Talking to Walk We and researching lighting

When a walker starts a voice session, the browser connects to GPT-Live over WebRTC. The voice tools use the active screen and the app's verified trip information. The worker keeps the key and applies origin and rate limits. See the [voice and research setup](README.md#optional-hosted-voice-and-research).

A separate control on night route results sends the selected public segment ID and graph version to the proxy. The proxy resolves the street name from the public graph. Research results wait for human review before any reuse as evidence.
