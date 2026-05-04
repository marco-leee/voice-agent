1. Noise suppression
2. Echo cancellation
3. Auto gain control
4. Pitch filtering
5. VAD
   1. SileroVAD
6. Turn detection
   1. Smart turn v3 by pipecat
7. Intelligent speaker filtering
    1. When there are multiple speakers, filter out the targeted speaker's audio voice
    2. Take an audio, detect the number of speakers, split the audio into separate audio streams for each speaker
    3. Selection strategy
       1. Volume based - loudest, closest to the microphone
       2. Voice pattern based - speaker identification, voice print matching