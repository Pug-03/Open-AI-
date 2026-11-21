import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { BestTime } from '../components/BestTime.tsx';
import { LogoMark } from '../components/Logo.tsx';
import { PLAN_BBOX, TRIPS } from '../components/plan-view/demo.ts';
import { prepareScene, type PreparedScene } from '../components/plan-view/planDraw.ts';
import { TLink } from '../components/TLink.tsx';
import { DataSheet } from '../components/welcome/DataSheet.tsx';
import { NightSection } from '../components/welcome/NightSection.tsx';
import { Plot } from '../components/welcome/Plot.tsx';
import { ShadowStage } from '../components/welcome/ShadowStage.tsx';
import { SunSection } from '../components/welcome/SunSection.tsx';
import { copy, type CopyKey } from '../landingCopy.ts';
import type { DatasetMeta } from '../routing/protocol.ts';
import { routing } from '../services.ts';
import { hasDoneSetup } from '../store/contacts.ts';
import { useI18n } from '../store/i18n.tsx';
import { markOnboarded } from '../store/onboarding.ts';
import { TEAM } from '../team.ts';
import { useGo } from '../utils/transition.ts';

// Welcome: the site as a shadow study of Siam. The first screen is the real
// plan with the shadows the engine computes for this minute (ShadowStage);
// below it the method, the best hour to leave, the night scoring, the data
// and its limits, and who made the app.

const NAV: Array<[string, CopyKey]> = [
  ['method', 'nav.method'],
  ['time', 'nav.time'],
  ['night', 'nav.night'],
  ['data', 'nav.data'],
  ['team', 'nav.team'],
];

export default function Landing() {
  const { lang, setLang } = useI18n();
  const c = (k: CopyKey, v?: Record<string, string | number>) => copy(lang, k, v);
  const go = useGo();
  const [prepared, setPrepared] = useState<PreparedScene | null>(null);
  const [failed, setFailed] = useState(false);
  const [meta, setMeta] = useState<DatasetMeta | null>(null);
  const [trip, setTrip] = useState(0);
  const [stageNight, setStageNight] = useState(false);
  const [onStage, setOnStage] = useState(true);
  const stageWrap = useRef<HTMLDivElement>(null);

  // Start = the first-run flag; next stop is the phone-number setup.
  const start = () => {
    markOnboarded();
    go(hasDoneSetup() ? '/plan' : '/setup');
  };

  // The plan's drawing data and the dataset's own figures, from the routing
  // worker (the same data the planner routes on), after the first paint.
  useEffect(() => {
    let live = true;
    const id = window.setTimeout(() => {
      routing.scene(PLAN_BBOX).then((s) => live && setPrepared(prepareScene(s)), () => live && setFailed(true));
      routing.warm().then((m) => live && setMeta(m), () => {});
    }, 60);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
  }, []);

  // The top strip takes the sheet's colour while the stage is under it.
  useEffect(() => {
    const el = stageWrap.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([e]) => setOnStage(!!e?.isIntersecting), { rootMargin: '0px 0px -92% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const info = TRIPS[trip]!;

  return (
    <div className="lp">
      <header className="lp-nav" data-theme={onStage && stageNight ? 'night' : undefined}>
        <a className="lp-brand" href="#top" onClick={(e) => (e.preventDefault(), window.scrollTo({ top: 0, behavior: 'smooth' }))} aria-label="Walk We">
          <LogoMark size={28} />
          <span>Walk We</span>
        </a>
        <nav aria-label={c('nav.sections')}>
          {NAV.map(([id, k]) => (
            <a key={id} href={`#${id}`} onClick={(e) => (e.preventDefault(), jump(id))}>
              {c(k)}
            </a>
          ))}
        </nav>
        <button
          type="button"
          className="lp-lang"
          onClick={() => setLang(lang === 'th' ? 'en' : 'th')}
          aria-label={lang === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
          lang={lang === 'th' ? 'en' : 'th'}
          data-testid="lang-toggle"
        >
          <span aria-current={lang === 'th' ? 'true' : undefined}>TH</span>
          <span aria-current={lang === 'en' ? 'true' : undefined}>EN</span>
        </button>
        <button type="button" className="btn btn--primary lp-nav-start" onClick={start} data-testid="nav-start">
          {c('nav.start')}
          <ArrowRight size={18} aria-hidden="true" className="btn-arrow" />
        </button>
      </header>

      <main id="top">
        <div ref={stageWrap}>
          <ShadowStage prepared={prepared} failed={failed} trip={trip} onTrip={setTrip} onStart={start} onNight={setStageNight} />
        </div>

        <SunSection />

        <section id="time" className="lp-section lp-best" aria-labelledby="time-title">
          <div className="lp-text">
            <Plot as="h2" className="lp-h2">
              <span id="time-title">{c('best.title')}</span>
            </Plot>
            <Plot as="p" className="lp-p" delay={80}>
              {c('best.p', { trip: `${info.from[lang]} → ${info.to[lang]}` })}
            </Plot>
          </div>
          <div className="lp-best-chart">
            <p className="lp-best-axis">{c('best.axis')}</p>
            <BestTime from={info.from} to={info.to} />
          </div>
        </section>

        <NightSection prepared={prepared} meta={meta} trip={trip} />

        <DataSheet meta={meta} />

        <section id="team" className="lp-section lp-team" aria-labelledby="team-title">
          <Plot as="h2" className="lp-h2">
            <span id="team-title">{c('team.title')}</span>
          </Plot>
          <ul className="lp-people">
            {TEAM.map((m, i) => (
              <Plot as="li" key={m.name} delay={i * 80}>
                <img src={m.avatar} alt="" width={96} height={96} loading="lazy" decoding="async" />
                <div className="lp-person">
                  <strong lang="en">{m.name}</strong>
                  <span className="lp-person-role" lang="en">{m.role}</span>
                  <p className="lp-person-description">{m.description[lang]}</p>
                </div>
              </Plot>
            ))}
          </ul>
        </section>
      </main>

      {/* The sheet's closing title block: one last way in, then who made it. */}
      <footer className="lp-foot">
        <div className="lp-foot-cta">
          <p>{c('foot.title')}</p>
          <button type="button" className="btn btn--primary" onClick={start} data-testid="foot-start">
            {c('foot.start')}
            <ArrowRight size={20} aria-hidden="true" className="btn-arrow" />
          </button>
        </div>
        <dl className="lp-foot-block">
          <div>
            <dt>{c('foot.project')}</dt>
            <dd className="lp-foot-name">
              <LogoMark size={26} />
              Walk We
            </dd>
          </div>
          <div>
            <dt>{c('foot.area')}</dt>
            <dd>{c('foot.areaV')}</dd>
          </div>
          <div>
            <dt>{c('foot.by')}</dt>
            <dd>หมูกรอบกับหมาไส้กรอกตะลุยอวกาศ</dd>
          </div>
          <div>
            <dt>© 2569 Walk We</dt>
            <dd className="lp-foot-links">
              <TLink to="/privacy">{c('foot.privacy')}</TLink>
              <TLink to="/data">{c('foot.dataLink')}</TLink>
            </dd>
          </div>
        </dl>
      </footer>
    </div>
  );
}
