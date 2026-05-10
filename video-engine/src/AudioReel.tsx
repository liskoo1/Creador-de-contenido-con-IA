import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  Easing,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { Audio } from '@remotion/media';
import {
  TransitionSeries,
  linearTiming,
  springTiming,
} from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import React, { useMemo } from 'react';
import type { Caption } from '@remotion/captions';
import { createTikTokStyleCaptions } from '@remotion/captions';

// ─── Google Fonts ───────────────────────────────────────────────────────────
const { fontFamily: interFamily } = loadInter();

const FONT_BODY = interFamily;

// ─── Types ──────────────────────────────────────────────────────────────────
type SubtitleEntry = {
  text: string;
  startMs: number;
  endMs: number;
};

type SceneData = {
  url: string;
  startFrame: number;
  durationFrames: number;
  subtitles: SubtitleEntry[];
};

export type AudioReelProps = {
  scenes: SceneData[];
  audioUrl: string;
  captions: Caption[];
};

// ─── Constants ──────────────────────────────────────────────────────────────
const TRANSITION_FRAMES = 15;
const SWITCH_CAPTIONS_EVERY_MS = 1500;

// ─── Ken Burns Background ───────────────────────────────────────────────────
const KenBurnsBackground: React.FC<{
  url: string;
  durationFrames: number;
  sceneIndex: number;
}> = ({ url, durationFrames, sceneIndex }) => {
  const frame = useCurrentFrame();

  const directions = [
    { scaleStart: 1.0, scaleEnd: 1.15, panStart: 0, panEnd: 20 },
    { scaleStart: 1.15, scaleEnd: 1.0, panStart: -15, panEnd: 15 },
    { scaleStart: 1.05, scaleEnd: 1.2, panStart: 10, panEnd: -10 },
    { scaleStart: 1.1, scaleEnd: 1.0, panStart: -20, panEnd: 0 },
  ];
  const dir = directions[sceneIndex % directions.length];

  const scale = interpolate(frame, [0, durationFrames], [dir.scaleStart, dir.scaleEnd], {
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.45, 0, 0.55, 1),
  });

  const panX = interpolate(frame, [0, durationFrames], [dir.panStart, dir.panEnd], {
    extrapolateRight: 'clamp',
  });

  return (
    <Img
      src={url}
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        transform: `scale(${scale}) translateX(${panX}px)`,
      }}
    />
  );
};

// ─── Subtitle Overlay (TikTok-style captions) ───────────────────────────────
const SubtitleOverlay: React.FC<{
  captions: Caption[];
}> = ({ captions }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const { pages } = useMemo(() => {
    return createTikTokStyleCaptions({
      captions,
      combineTokensWithinMilliseconds: SWITCH_CAPTIONS_EVERY_MS,
    });
  }, [captions]);

  const currentTimeMs = (frame / fps) * 1000;

  const currentPage = pages.find((page, index) => {
    const nextPage = pages[index + 1];
    const endMs = nextPage ? nextPage.startMs : Infinity;
    return currentTimeMs >= page.startMs && currentTimeMs < endMs;
  });

  if (!currentPage) return null;

  // Scale-in animation for subtitle appearance
  const pageAge = currentTimeMs - currentPage.startMs;
  const scaleIn = interpolate(pageAge, [0, 150], [0.92, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const opIn = interpolate(pageAge, [0, 100], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        padding: '0 40px 120px 40px',
      }}
    >
      <div
        style={{
          background: 'rgba(0, 0, 0, 0.7)',
          borderRadius: '16px',
          padding: '18px 30px',
          maxWidth: '90%',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.08)',
          transform: `scale(${scaleIn})`,
          opacity: opIn,
        }}
      >
        <p
          style={{
            color: '#fff',
            fontSize: '50px',
            fontWeight: 800,
            fontFamily: FONT_BODY,
            textAlign: 'center',
            lineHeight: 1.3,
            margin: 0,
            whiteSpace: 'pre',
            textShadow: '0 2px 12px rgba(0,0,0,0.8), 0 0 4px rgba(0,0,0,1)',
            WebkitTextStroke: '1px rgba(0,0,0,0.3)',
          }}
        >
          {currentPage.tokens.map((token) => {
            const isActive =
              token.fromMs <= currentTimeMs && token.toMs > currentTimeMs;

            return (
              <span
                key={token.fromMs}
                style={{
                  color: isActive ? '#00f0ff' : '#ffffff',
                  textShadow: isActive 
                    ? '0 0 20px rgba(0,240,255,0.5), 0 2px 8px rgba(0,0,0,0.6)' 
                    : '0 2px 8px rgba(0,0,0,0.6)',
                  transition: 'color 0.1s, text-shadow 0.1s',
                }}
              >
                {token.text}
              </span>
            );
          })}
        </p>
      </div>
    </AbsoluteFill>
  );
};

// ─── Scene Component ────────────────────────────────────────────────────────
const AudioScene: React.FC<{
  url: string;
  durationFrames: number;
  sceneIndex: number;
}> = ({ url, durationFrames, sceneIndex }) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  return (
    <AbsoluteFill style={{ backgroundColor: '#000', opacity }}>
      <KenBurnsBackground
        url={url}
        durationFrames={durationFrames}
        sceneIndex={sceneIndex}
      />
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.3) 30%, rgba(0,0,0,0) 50%)',
        }}
      />
    </AbsoluteFill>
  );
};

// ─── Transition Selection (varied) ──────────────────────────────────────────
function getAudioTransition(index: number): import('@remotion/transitions').TransitionPresentation<Record<string, unknown>> {
  const transitions = [
    () => fade(),
    () => slide({ direction: 'from-right' }),
    () => wipe({ direction: 'from-left' }),
    () => fade(),
    () => slide({ direction: 'from-left' }),
  ];
  return transitions[index % transitions.length]() as import('@remotion/transitions').TransitionPresentation<Record<string, unknown>>;
}

// ─── Main Composition ───────────────────────────────────────────────────────
export const AudioReel: React.FC<AudioReelProps> = ({
  scenes,
  audioUrl,
  captions,
}) => {
  if (!scenes || scenes.length === 0) return null;

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* Audio track */}
      <Audio src={audioUrl} />

      {/* Scene backgrounds with varied transitions */}
      <TransitionSeries>
        {scenes.map((scene, i) => (
          <React.Fragment key={i}>
            <TransitionSeries.Sequence durationInFrames={scene.durationFrames}>
              <AudioScene
                url={scene.url}
                durationFrames={scene.durationFrames}
                sceneIndex={i}
              />
            </TransitionSeries.Sequence>
            {i < scenes.length - 1 && (
              <TransitionSeries.Transition
                presentation={getAudioTransition(i)}
                timing={springTiming({ config: { damping: 200 }, durationInFrames: TRANSITION_FRAMES })}
              />
            )}
          </React.Fragment>
        ))}
      </TransitionSeries>

      {/* Subtitles overlay */}
      {captions && captions.length > 0 && (
        <SubtitleOverlay captions={captions} />
      )}
    </AbsoluteFill>
  );
};
