# Audio Input Layers

This is a list of layers that can be used to capture audio input.

## Browser

Layer from bottom to top

1. Hardware level
   1. Microphone
   2. Memory
2. OS level
   1. Audio driver
   2. Audio encoder and decoder
3. Browser level
   1. Web Audio API
   2. Media permissions
   3. Device Selection
   4. Media stream tracks
4. Web Audio API level
   1. Audio Context
      1. An audio processing graph linked together by AudioNode. All audio processing should be done in the AudioContext.
      2. This is a processing pipeline for audio stream. Node in between are AudioNodes.
      3. Can customise the audio processing pipeline by adding or removing AudioNodes.
      4. One conversation stream should only have one AudioContext.
      5. 

## Mobile

### iOS

### Android