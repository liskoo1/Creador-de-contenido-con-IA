import {
  AbsoluteFill,
  Img,
  Video,
  interpolate,
  Easing,
  useCurrentFrame,
  useVideoConfig,
  Sequence,
} from 'remotion';
import {
  TransitionSeries,
  linearTiming,
  springTiming,
} from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { flip } from '@remotion/transitions/flip';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadPlayfair } from '@remotion/google-fonts/PlayfairDisplay';
import React from 'react';

// ─── Google Fonts ───────────────────────────────────────────────────────────
const { fontFamily: interFamily } = loadInter();
const { fontFamily: playfairFamily } = loadPlayfair();

const FONT_TITLE = playfairFamily;
const FONT_BODY = interFamily;
const FONT_MONO = '"JetBrains Mono", "Courier New", monospace';

// ─── Constantes ─────────────────────────────────────────────────────────────
const SCENE_FRAMES = 150;      // 5 s a 30 fps
const TRANSITION_FRAMES = 18;  // 0.6 s de transición
const FADEOUT_START = SCENE_FRAMES - 25; // Fade-out comienza 25 frames antes del fin

// ─── Estilos de fondo ───────────────────────────────────────────────────────
type StyleId = 'cinematic' | 'glitch' | 'slide-up' | 'zoom-reveal' | 'split' | 'typewriter' | 'neon-glow' | 'minimal-bar';

const ANIMATION_STYLES: StyleId[] = [
  'cinematic',
  'slide-up',
  'zoom-reveal',
  'split',
  'glitch',
  'typewriter',
  'neon-glow',
  'minimal-bar',
];

// ─── Mood color map ─────────────────────────────────────────────────────────
type MoodId = 'epic' | 'calm' | 'urgent' | 'playful' | 'dark' | 'inspiring';
const MOOD_COLORS: Record<MoodId, string> = {
  epic: 'rgba(180,140,50,0.15)',
  calm: 'rgba(74,144,217,0.12)',
  urgent: 'rgba(255,45,85,0.18)',
  playful: 'rgba(123,47,190,0.14)',
  dark: 'rgba(0,0,0,0.25)',
  inspiring: 'rgba(255,200,50,0.10)',
};

// ─── Fade-out helper ────────────────────────────────────────────────────────
function useFadeOut(frame: number): number {
  return interpolate(frame, [FADEOUT_START, SCENE_FRAMES], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: Easing.bezier(0.4, 0, 1, 1),
  });
}

// ─── Background ─────────────────────────────────────────────────────────────
const SceneBackground: React.FC<{ url: string; styleId: StyleId }> = ({ url, styleId }) => {
  const frame = useCurrentFrame();
  const isVideo = url.toLowerCase().endsWith('.mp4');

  const scaleStart = styleId === 'zoom-reveal' ? 1.35 : 1.05;
  const scaleEnd   = styleId === 'zoom-reveal' ? 1.0  : 1.22;
  const scale = interpolate(frame, [0, SCENE_FRAMES], [scaleStart, scaleEnd], {
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.45, 0, 0.55, 1),
  });

  const panX = (styleId === 'slide-up' || styleId === 'split')
    ? interpolate(frame, [0, SCENE_FRAMES], [-30, 30], { extrapolateRight: 'clamp' })
    : 0;

  return (
    <>
      {isVideo ? (
        <Video src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <Img
          src={url}
          style={{
            width: '100%', height: '100%', objectFit: 'cover',
            transform: `scale(${scale}) translateX(${panX}px)`,
          }}
        />
      )}
    </>
  );
};

// ─── Overlays de gradiente ──────────────────────────────────────────────────
const Gradient: React.FC<{ styleId: StyleId }> = ({ styleId }) => {
  const gradients: Record<StyleId, string> = {
    'cinematic':    'linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.10) 60%)',
    'glitch':       'linear-gradient(160deg, rgba(10,0,30,0.82) 0%, rgba(0,0,0,0.30) 100%)',
    'slide-up':     'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.20) 55%)',
    'zoom-reveal':  'radial-gradient(ellipse at center, rgba(0,0,0,0.0) 0%, rgba(0,0,0,0.75) 100%)',
    'split':        'linear-gradient(to right, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.10) 60%)',
    'typewriter':   'linear-gradient(to bottom, rgba(0,0,0,0.80) 0%, rgba(0,0,0,0.20) 50%, rgba(0,0,0,0.80) 100%)',
    'neon-glow':    'linear-gradient(to top, rgba(0,0,20,0.92) 0%, rgba(0,0,40,0.30) 60%)',
    'minimal-bar':  'linear-gradient(to top, rgba(0,0,0,0.90) 0%, rgba(0,0,0,0.05) 40%)',
  };
  return <AbsoluteFill style={{ background: gradients[styleId] }} />;
};

// ─── Progress Bar ───────────────────────────────────────────────────────────
const ProgressBar: React.FC<{ sceneIndex: number; totalScenes: number }> = ({ sceneIndex, totalScenes }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, SCENE_FRAMES], [0, 1], { extrapolateRight: 'clamp' });
  const segmentWidth = 100 / totalScenes;
  const completedWidth = sceneIndex * segmentWidth;
  const currentWidth = progress * segmentWidth;

  return (
    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '4px', background: 'rgba(255,255,255,0.15)' }}>
      <div style={{
        height: '100%',
        width: `${completedWidth + currentWidth}%`,
        background: 'linear-gradient(90deg, #00f0ff, #7b2fbe)',
        transition: 'none',
      }} />
    </div>
  );
};

// ─── Componentes de texto por estilo ────────────────────────────────────────

const CinematicText: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeOut = useFadeOut(frame);

  const titleOpacity = interpolate(frame, [0, fps], [0, 1], { extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1) }) * fadeOut;
  const titleY = interpolate(frame, [0, fps], [60, 0], { extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1) });
  const subOpacity = interpolate(frame, [fps * 0.6, fps * 1.4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) * fadeOut;
  const lineScale = interpolate(frame, [fps * 0.4, fps * 1.0], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'flex-start', padding: '80px 70px' }}>
      <div>
        <p style={{ color: '#fff', fontSize: '82px', fontWeight: 900, fontFamily: FONT_TITLE, lineHeight: 1.05, textTransform: 'uppercase', letterSpacing: '-2px', textShadow: '0 4px 30px rgba(0,0,0,0.8)', opacity: titleOpacity, transform: `translateY(${titleY}px)`, margin: 0 }}>{title}</p>
        <div style={{ height: '4px', background: 'linear-gradient(90deg, #00f0ff, #7b2fbe)', marginTop: '18px', transform: `scaleX(${lineScale * fadeOut})`, transformOrigin: 'left' }} />
        <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: '36px', fontWeight: 400, fontFamily: FONT_BODY, marginTop: '16px', opacity: subOpacity, letterSpacing: '1px' }}>{subtitle}</p>
      </div>
    </AbsoluteFill>
  );
};

const GlitchText: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeOut = useFadeOut(frame);

  const glitchFrames = [12, 28, 72, 105, 130];
  const isGlitch = glitchFrames.some(f => Math.abs(frame - f) < 3);
  const offsetR = isGlitch ? Math.sin(frame * 37) * 6 : 0;
  const offsetB = isGlitch ? Math.sin(frame * 53 + 1) * -5 : 0;

  const enter = interpolate(frame, [0, fps * 0.5], [0, 1], { extrapolateRight: 'clamp', easing: Easing.bezier(0.34, 1.56, 0.64, 1) }) * fadeOut;
  const scaleIn = interpolate(frame, [0, fps * 0.5], [0.85, 1], { extrapolateRight: 'clamp', easing: Easing.bezier(0.34, 1.56, 0.64, 1) });

  const titleStyle: React.CSSProperties = { fontSize: '90px', fontWeight: 900, textTransform: 'uppercase', fontFamily: FONT_MONO, lineHeight: 1, margin: 0, opacity: enter, transform: `scale(${scaleIn})` };

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: '60px' }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{ ...titleStyle, color: 'rgba(255,50,50,0.75)', position: 'absolute', transform: `scale(${scaleIn}) translateX(${offsetR}px)` }}>{title}</p>
        <p style={{ ...titleStyle, color: 'rgba(50,100,255,0.75)', position: 'absolute', transform: `scale(${scaleIn}) translateX(${offsetB}px)` }}>{title}</p>
        <p style={{ ...titleStyle, color: '#fff', position: 'relative' }}>{title}</p>
        <Sequence from={fps * 0.6} premountFor={fps}>
          <p style={{ color: '#0ff', fontSize: '34px', fontFamily: FONT_MONO, letterSpacing: '4px', marginTop: '24px', opacity: interpolate(frame - fps * 0.6, [0, fps * 0.4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) * fadeOut }}>{'>  '}{subtitle}</p>
        </Sequence>
      </div>
    </AbsoluteFill>
  );
};

const SlideUpText: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeOut = useFadeOut(frame);
  const words = title.split(' ');

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', padding: '80px 60px' }}>
      <div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', overflow: 'hidden' }}>
          {words.map((word, i) => {
            const delay = i * 7;
            const progress = interpolate(frame - delay, [0, fps * 0.6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.22, 1, 0.36, 1) });
            return (
              <div key={i} style={{ overflow: 'hidden' }}>
                <span style={{ display: 'block', color: '#fff', fontSize: '80px', fontWeight: 900, fontFamily: FONT_BODY, textTransform: 'uppercase', lineHeight: 1.1, textShadow: '0 8px 30px rgba(0,0,0,0.9)', transform: `translateY(${interpolate(progress, [0, 1], [110, 0])}px)`, opacity: progress * fadeOut }}>{word}</span>
              </div>
            );
          })}
        </div>
        <Sequence from={fps * 1.2} premountFor={fps}>
          <p style={{ color: 'rgba(255,255,255,0.80)', fontSize: '36px', fontFamily: FONT_BODY, marginTop: '14px', opacity: interpolate(frame - fps * 1.2, [0, fps * 0.5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) * fadeOut }}>{subtitle}</p>
        </Sequence>
      </div>
    </AbsoluteFill>
  );
};

const ZoomRevealText: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeOut = useFadeOut(frame);

  const reveal = interpolate(frame, [fps * 0.3, fps * 1.1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1) }) * fadeOut;
  const titleScale = interpolate(frame, [fps * 0.3, fps * 1.1], [1.6, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1) });

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: '60px', textAlign: 'center' }}>
      <div>
        <p style={{ color: '#fff', fontSize: '94px', fontWeight: 900, fontFamily: FONT_TITLE, textTransform: 'uppercase', lineHeight: 1.0, textShadow: '0 0 60px rgba(255,255,255,0.4)', opacity: reveal, transform: `scale(${titleScale})`, margin: 0 }}>{title}</p>
        <Sequence from={fps * 1.0} premountFor={fps}>
          <p style={{ color: '#fff', fontSize: '38px', marginTop: '28px', fontFamily: FONT_BODY, letterSpacing: '8px', textTransform: 'uppercase', opacity: interpolate(frame - fps, [0, fps * 0.5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) * fadeOut }}>{subtitle}</p>
        </Sequence>
      </div>
    </AbsoluteFill>
  );
};

const SplitText: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeOut = useFadeOut(frame);

  const enterLeft = interpolate(frame, [0, fps * 0.8], [-500, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.22, 1, 0.36, 1) });
  const enterRight = interpolate(frame, [fps * 0.4, fps * 1.2], [500, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.22, 1, 0.36, 1) });
  const opLeft = interpolate(frame, [0, fps * 0.5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) * fadeOut;
  const opRight = interpolate(frame, [fps * 0.4, fps * 0.9], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) * fadeOut;

  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: '60px', flexDirection: 'column', gap: '20px' }}>
      <p style={{ color: '#fff', fontSize: '86px', fontWeight: 900, fontFamily: FONT_TITLE, textTransform: 'uppercase', lineHeight: 1.05, margin: 0, textShadow: '0 6px 30px rgba(0,0,0,0.8)', transform: `translateX(${enterLeft}px)`, opacity: opLeft }}>{title}</p>
      <p style={{ color: 'rgba(255,255,255,0.80)', fontSize: '38px', fontFamily: FONT_BODY, textAlign: 'right', margin: 0, transform: `translateX(${enterRight}px)`, opacity: opRight }}>{subtitle}</p>
    </AbsoluteFill>
  );
};

const TypewriterText: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeOut = useFadeOut(frame);

  const titleChars = Math.floor(frame / 2);
  const titleVisible = title.slice(0, titleChars);
  const subStart = (title.length * 2) + fps * 0.3;
  const subChars = Math.max(0, Math.floor((frame - subStart) / 1.5));
  const subVisible = subtitle.slice(0, subChars);
  const cursor = frame % 30 < 20 ? '|' : '';

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'flex-start', padding: '80px 70px', opacity: fadeOut }}>
      <div>
        <p style={{ color: '#fff', fontSize: '74px', fontWeight: 700, fontFamily: FONT_MONO, lineHeight: 1.1, textTransform: 'uppercase', textShadow: '0 4px 20px rgba(0,0,0,0.9)', margin: 0 }}>{titleVisible}{titleChars < title.length ? cursor : ''}</p>
        {subVisible.length > 0 && (
          <p style={{ color: '#0ff', fontSize: '34px', fontFamily: FONT_MONO, marginTop: '20px', letterSpacing: '2px' }}>{subVisible}{subChars < subtitle.length ? cursor : ''}</p>
        )}
      </div>
    </AbsoluteFill>
  );
};

/** NEON-GLOW — título con resplandor neón animado */
const NeonGlowText: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeOut = useFadeOut(frame);

  const enter = interpolate(frame, [0, fps * 0.8], [0, 1], { extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1) }) * fadeOut;
  const glowPulse = Math.sin(frame * 0.08) * 15 + 40;
  const subEnter = interpolate(frame, [fps * 0.8, fps * 1.5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) * fadeOut;

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: '60px', textAlign: 'center' }}>
      <div>
        <p style={{ color: '#00f0ff', fontSize: '88px', fontWeight: 900, fontFamily: FONT_BODY, textTransform: 'uppercase', lineHeight: 1.05, margin: 0, opacity: enter, textShadow: `0 0 ${glowPulse}px rgba(0,240,255,0.6), 0 0 ${glowPulse * 2}px rgba(0,240,255,0.3), 0 4px 20px rgba(0,0,0,0.9)`, letterSpacing: '-1px' }}>{title}</p>
        <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '36px', fontFamily: FONT_BODY, fontWeight: 400, marginTop: '24px', opacity: subEnter, letterSpacing: '3px' }}>{subtitle}</p>
      </div>
    </AbsoluteFill>
  );
};

/** MINIMAL-BAR — barra inferior con texto limpio */
const MinimalBarText: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeOut = useFadeOut(frame);

  const barSlide = interpolate(frame, [0, fps * 0.6], [-100, 0], { extrapolateRight: 'clamp', easing: Easing.bezier(0.22, 1, 0.36, 1) });
  const textOp = interpolate(frame, [fps * 0.3, fps * 0.8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) * fadeOut;
  const accentWidth = interpolate(frame, [fps * 0.5, fps * 1.2], [0, 100], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end' }}>
      <div style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(20px)', padding: '40px 60px', transform: `translateY(${barSlide}%)`, opacity: fadeOut }}>
        <div style={{ width: `${accentWidth}%`, height: '3px', background: 'linear-gradient(90deg, #00f0ff, #7b2fbe)', marginBottom: '20px' }} />
        <p style={{ color: '#fff', fontSize: '72px', fontWeight: 800, fontFamily: FONT_BODY, textTransform: 'uppercase', lineHeight: 1.1, margin: 0, opacity: textOp }}>{title}</p>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '32px', fontFamily: FONT_BODY, fontWeight: 400, marginTop: '10px', opacity: textOp }}>{subtitle}</p>
      </div>
    </AbsoluteFill>
  );
};

// ─── Mapa de componentes de texto ───────────────────────────────────────────
const TEXT_COMPONENTS: Record<StyleId, React.FC<{ title: string; subtitle: string }>> = {
  'cinematic':   CinematicText,
  'glitch':      GlitchText,
  'slide-up':    SlideUpText,
  'zoom-reveal': ZoomRevealText,
  'split':       SplitText,
  'typewriter':  TypewriterText,
  'neon-glow':   NeonGlowText,
  'minimal-bar': MinimalBarText,
};

// ─── Escena individual ──────────────────────────────────────────────────────
const Scene: React.FC<{
  url: string;
  title: string;
  subtitle: string;
  sceneIndex: number;
  totalScenes: number;
}> = ({ url, title, subtitle, sceneIndex, totalScenes }) => {
  const styleId = ANIMATION_STYLES[sceneIndex % ANIMATION_STYLES.length];
  const TextComp = TEXT_COMPONENTS[styleId];

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <SceneBackground url={url} styleId={styleId} />
      <Gradient styleId={styleId} />
      <TextComp title={title} subtitle={subtitle} />
      <ProgressBar sceneIndex={sceneIndex} totalScenes={totalScenes} />
    </AbsoluteFill>
  );
};

// ─── Selección de transición ────────────────────────────────────────────────
function getTransition(index: number): import('@remotion/transitions').TransitionPresentation<Record<string, unknown>> {
  const transitions = [
    () => fade(),
    () => slide({ direction: 'from-right' }),
    () => slide({ direction: 'from-left' }),
    () => wipe({ direction: 'from-right' }),
    () => flip({ direction: 'from-right' }),
  ];
  return transitions[index % transitions.length]() as import('@remotion/transitions').TransitionPresentation<Record<string, unknown>>;
}

// ─── Composición raíz ────────────────────────────────────────────────────────
export const SwarmReel: React.FC<{
  scenes: Array<{ url: string; title: string; subtitle: string }>;
}> = ({ scenes }) => {
  if (!scenes || scenes.length === 0) return null;

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <TransitionSeries>
        {scenes.map((scene, i) => (
          <React.Fragment key={i}>
            <TransitionSeries.Sequence durationInFrames={SCENE_FRAMES}>
              <Scene
                url={scene.url}
                title={scene.title}
                subtitle={scene.subtitle}
                sceneIndex={i}
                totalScenes={scenes.length}
              />
            </TransitionSeries.Sequence>
            {i < scenes.length - 1 && (
              <TransitionSeries.Transition
                presentation={getTransition(i)}
                timing={i % 2 === 0
                  ? linearTiming({ durationInFrames: TRANSITION_FRAMES })
                  : springTiming({ config: { damping: 200 }, durationInFrames: TRANSITION_FRAMES })
                }
              />
            )}
          </React.Fragment>
        ))}
      </TransitionSeries>
    </AbsoluteFill>
  );
};
