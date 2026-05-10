import { Composition, CalculateMetadataFunction } from 'remotion';
import { SwarmReel } from './SwarmReel';
import { AudioReel } from './AudioReel';
import type { AudioReelProps } from './AudioReel';

const SCENE_FRAMES = 150;
const TRANSITION_FRAMES = 18;

type SwarmReelProps = {
  scenes: Array<{ url: string; title: string; subtitle: string }>;
};

/**
 * Duración total = escenas * SCENE_FRAMES - transiciones * TRANSITION_FRAMES
 * Las transiciones de @remotion/transitions solapan las escenas adyacentes.
 */
const calculateMetadata: CalculateMetadataFunction<SwarmReelProps> = ({ props }) => {
  const count = props.scenes && props.scenes.length > 0 ? props.scenes.length : 1;
  const transitions = Math.max(0, count - 1);
  return {
    durationInFrames: count * SCENE_FRAMES - transitions * TRANSITION_FRAMES,
  };
};

/**
 * AudioReel: duración basada en la suma de frames de todas las escenas,
 * menos las transiciones de solapamiento (15 frames cada una).
 */
const AUDIO_REEL_TRANSITION_FRAMES = 15;
const calculateAudioReelMetadata: CalculateMetadataFunction<AudioReelProps> = ({ props }) => {
  if (!props.scenes || props.scenes.length === 0) {
    return { durationInFrames: 30 };
  }
  const totalSceneFrames = props.scenes.reduce((sum, s) => sum + s.durationFrames, 0);
  const transitions = Math.max(0, props.scenes.length - 1);
  return {
    durationInFrames: totalSceneFrames - transitions * AUDIO_REEL_TRANSITION_FRAMES,
  };
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="SwarmReel"
        component={SwarmReel}
        durationInFrames={SCENE_FRAMES}
        fps={30}
        width={1080}
        height={1920}
        calculateMetadata={calculateMetadata}
        defaultProps={{ scenes: [] }}
      />
      <Composition
        id="AudioReel"
        component={AudioReel}
        durationInFrames={300}
        fps={30}
        width={1080}
        height={1920}
        calculateMetadata={calculateAudioReelMetadata}
        defaultProps={{
          scenes: [],
          audioUrl: '',
          captions: [],
        }}
      />
    </>
  );
};
