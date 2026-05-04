# Voice Agent

Here is a list of components of what makes up a voice agent:

1. Audio input / preprocessing [Note](./audio-input.md)
   1. Can be browsers, mobile, desktop, TV, watches, etc. APIs depends on the platform.
2. Automatic Speech Recognition (ASR)
   1. STT is only one of them. Main point is to extract any information you can think of from the audio.
   2. Sentiment analysis, tone recognition etc
3. Dialog / Conversation Management
   1. Conversation threads
4. Core Intelligence machine
   1. The agent engine - generate a response or action
5. Memory layer
    1. Short, long term memory, episodic memory, etc
6. Backend integration
   1. External tools and APIs
   2. DB
7. Natural Language Generation (NLG)
   1. Convert the response into natural languages
   2. Add personality and tone to the response
8. Text to Speech (TTS)
   1. Convert the text into audio
   2. Add personality and tone to the audio
9.  Network / Transport layer
   1. Websocket, webrtc etc
10. Orchestration Layer
    1. More like application system level stuff. 
    2. Scaling, scheduling, spawning new instances etc
 11. Safety and Security
     1.  Encryption, authentication, authorization, etc
     2.  Compliance, privacy, etc
     3.  LLM output guardrails <- important
 12. Monitoring and Logging
     1.  Metrics, alerts, logs, etc
     2.  Performance monitoring
     3.  Error tracking
 13. Deployment infrastructure
     1.  Different to orchestration layer. Base infra where the app system runs on.
     2.  GPU, CPU, Memory, Storage, Networking, etc