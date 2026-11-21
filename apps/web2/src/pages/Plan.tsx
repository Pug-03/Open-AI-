import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Accessibility, CircleCheck, LocateFixed, MapPin, Mic, Moon, Sun } from 'lucide-react';
import { AccessPanel } from '../components/AccessPanel.tsx';
import { setAccess, useAccess } from '../store/access.ts';
import { activeCity } from '@walkwe/config';
import {
  bboxContains,
  GeoError,
  haversineMeters,
  instantFromLocal,
  localInputValue,
  modeForTime,
  RoutingError,
  type LatLng,
  type NightFactor,
  type Place,
  type WalkMode,
} from '@walkwe/core';
import { speechParts, type VoiceActions } from '@walkwe/core/voice';
import type { SavedPlace, SavedSlot } from '@walkwe/data';
import { BottomSheet, SIDE_PANEL_SPACE, TOP_RESERVE, type Snap } from '../components/BottomSheet.tsx';
import { useDesktop } from '../utils/useDesktop.ts';
import { LogoMark } from '../components/Logo.tsx';
import { useSpeech } from '../utils/useSpeech.ts';
import { LazyMapView } from '../components/MapView.lazy.ts';
import { MapBoundary } from '../components/MapBoundary.tsx';
import { PickerBody, PickerHeader } from '../components/plan/PlacePicker.tsx';
import { RouteCard } from '../components/plan/RouteCard.tsx';
import { ResultsHeader, RouteResults, type RoutingState } from '../components/plan/RouteResults.tsx';
import { AgenticAsk } from '../components/plan/AgenticTrip.tsx';
import { planRequest, publicLandmark, receiveIntent, type AgenticIntent } from '../agentic.ts';
import { LiveVoice } from '../components/LiveVoice.tsx';
import { verifiedRouteSummary } from '../voice/route.ts';
import { routeReviewActions } from '../voice/reviewActions.ts';
import { useRouteReview } from '../voice/routeReview.ts';
import { WalkTimePanel, type Departure } from '../components/plan/WalkTimePanel.tsx';
import { GeoHelp, type GeoProblem } from '../components/plan/GeoHelp.tsx';
import { currentGeoEnvironment } from '../platform/geoEnv.ts';
import { SavedSlots } from '../components/plan/SavedSlots.tsx';
import { SettingsPanel } from '../components/plan/SettingsPanel.tsx';
import { usePlaceSearch } from '../components/plan/usePlaceSearch.ts';
import { Dialog, useToast } from '../components/ui.tsx';
import type { DatasetMeta } from '../routing/protocol.ts';
import { platform, routing, weather } from '../services.ts';
import { useI18n } from '../store/i18n.tsx';
import { usePlaces } from '../store/places.tsx';
import { CURRENT_ID, pinId, type Field, type PickedKind, type PickedPlace } from '../store/plan.ts';
import { useTheme } from '../store/theme.tsx';
import { useGo } from '../utils/transition.ts';
import { loadGuides } from '../nav/guides.ts';
import { buildSession, saveSession } from '../nav/session.ts';
import { coordText, formatDistance } from '../utils/format.ts';
import { safeAreaInset } from '../utils/safeArea.ts';
import { readJson, storage, writeJson } from '../utils/storage.ts';

const FACTORS_KEY = 'ww_night_factors';
const ALL_FACTORS: NightFactor[] = ['crowded', 'cctv', 'lit'];
function loadFactors(): NightFactor[] {
  const v = readJson(storage, FACTORS_KEY);
  const list = Array.isArray(v) ? (v.filter((x) => ALL_FACTORS.includes(x as NightFactor)) as NightFactor[]) : [];
  return list.length ? list : ALL_FACTORS; // default: all three
}

type Mode = { type: 'overview' } | { type: 'results' } | { type: 'pick'; field: Field; slot?: SavedSlot } | { type: 'pin'; field: Field; slot?: SavedSlot };

const SLOTS: SavedSlot[] = ['home', 'work', 'station', 'other'];

/**
 * Map-first planning screen: full-screen map, one bottom sheet. Phase 1
 * ends when both points are chosen; routing plugs in after that.
 */
/** Judges' demo (/plan?demo=1): the pilot route that has a photo guide. */
function demoPlaces(lang: 'th' | 'en'): { from: PickedPlace; to: PickedPlace } {
  return {
    from: publicLandmark('bts:CEN', lang)!,
    to: publicLandmark('osm:W157482067', lang)!,
  };
}

export default function Plan() {
  const { t, lang } = useI18n();
  const { theme } = useTheme();
  const toast = useToast();
  const places = usePlaces();

  const [demo] = useState(() => (new URLSearchParams(window.location.search).has('demo') ? demoPlaces(lang) : null));
  const [from, setFrom] = useState<PickedPlace | null>(demo?.from ?? null);
  const [to, setTo] = useState<PickedPlace | null>(demo?.to ?? null);
  const [mode, setMode] = useState<Mode>({ type: 'overview' });
  const [snap, setSnap] = useState<Snap>('half');
  const [query, setQuery] = useState('');
  const [sheetH, setSheetH] = useState(0);
  // Mic on the planner: open the search and start listening at once.
  const [listenOnOpen, setListenOnOpen] = useState(false);
  const voiceOk = useSpeech(lang, () => {}).supported;
  const desktop = useDesktop();
  const leftInset = desktop ? SIDE_PANEL_SPACE : 0;
  const [topInset] = useState(() => TOP_RESERVE + safeAreaInset('top'));
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [geoAsk, setGeoAsk] = useState<{ field: Field; slot?: SavedSlot } | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoHelp, setGeoHelp] = useState<{ problem: GeoProblem; field: Field; slot?: SavedSlot } | null>(null);
  const geoEnv = useMemo(currentGeoEnvironment, []);
  const [saveOpen, setSaveOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const access = useAccess();
  const [departure, setDeparture] = useState<Departure>({ kind: 'now' });
  const [modeOverride, setModeOverride] = useState<WalkMode | null>(null);
  const [factors, setFactorsState] = useState<NightFactor[]>(loadFactors);
  const setFactors = (f: NightFactor[]) => {
    setFactorsState(f);
    writeJson(storage, FACTORS_KEY, f);
  };
  const [routingState, setRoutingState] = useState<RoutingState | null>(null);
  const review = useRouteReview();
  const [reviewFirst, setReviewFirst] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [meta, setMeta] = useState<DatasetMeta | null>(null);
  const routeRun = useRef(0);
  const mapCenter = useRef<LatLng>(activeCity.center);
  // Text first: fetch the ~280 KB map chunk only after the fonts are in and
  // the first frame has painted, so on a slow connection it never delays
  // what the user reads first (the sheet). The map follows a moment later.
  const [loadMap, setLoadMap] = useState(false);
  useEffect(() => {
    let live = true;
    const go = () => live && setLoadMap(true);
    const afterPaint = () =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => ('requestIdleCallback' in window ? requestIdleCallback(go, { timeout: 800 }) : setTimeout(go, 50))),
      );
    const fallback = setTimeout(go, 2000); // never wait longer than this
    (document.fonts?.ready ?? Promise.resolve()).then(afterPaint, afterPaint);
    return () => {
      live = false;
      clearTimeout(fallback);
    };
  }, []);
  const searchRef = useRef<HTMLInputElement>(null);

  const near = from?.location ?? activeCity.center;
  const search = usePlaceSearch(mode.type === 'pick' ? query : '', lang, near);

  const openPick = useCallback((field: Field, slot?: SavedSlot) => {
    setQuery('');
    setMode(slot ? { type: 'pick', field, slot } : { type: 'pick', field });
    setSnap('full');
  }, []);

  const backToOverview = useCallback(() => {
    setListenOnOpen(false);
    setMode({ type: 'overview' });
    setQuery('');
    setSnap('half');
  }, []);

  /** One-shot position. On failure, explain why (instead of a vague toast). */
  const locate = useCallback(
    async (field: Field, slot?: SavedSlot): Promise<LatLng | null> => {
      setLocating(true);
      try {
        const fix = await platform.currentPosition();
        return { lat: fix.lat, lng: fix.lng };
      } catch (e) {
        const reason = e instanceof GeoError ? e.reason : 'unavailable';
        const problem: GeoProblem = reason === 'denied' ? (geoEnv.inApp ? 'in-app' : 'denied') : reason === 'unsupported' ? 'unsupported' : 'timeout';
        setGeoHelp(slot ? { problem, field, slot } : { problem, field });
        return null;
      } finally {
        setLocating(false);
      }
    },
    [geoEnv],
  );

  const placeFor = (loc: LatLng, slot?: SavedSlot): PickedPlace =>
    slot
      ? { id: pinId(loc), name: t('plan.pinnedPlace'), detail: coordText(loc), location: loc, kind: 'pin' }
      : { id: CURRENT_ID, name: t('plan.currentLocation'), detail: '', location: loc, kind: 'current' };

  const apply = useCallback(
    (field: Field, place: PickedPlace, slot?: SavedSlot) => {
      if (slot) {
        places.save(place, slot);
        toast(t('slot.saved', { slot: t(`slot.${slot}`) }));
        backToOverview();
        return;
      }
      if (place.kind !== 'current') places.noteUsed(place);
      if (!bboxContains(activeCity.pilotBounds, place.location)) toast(t('plan.outsidePilot'), 5000);
      const nextFrom = field === 'from' ? place : from;
      const nextTo = field === 'to' ? place : to;
      setFrom(nextFrom);
      setTo(nextTo);
      // Guide straight to whichever point is still missing.
      if (!nextTo) openPick('to');
      else if (!nextFrom) openPick('from');
      else backToOverview();
    },
    [from, to, places, toast, t, backToOverview, openPick],
  );

  const useCurrent = useCallback(
    async (field: Field, slot?: SavedSlot) => {
      const withSlot = <T extends object>(o: T) => (slot ? { ...o, slot } : o);
      // Problems no permission prompt can fix: say so straight away.
      if (!geoEnv.secure) return setGeoHelp(withSlot({ problem: 'insecure' as const, field }));
      const permission = await platform.geoPermission();
      if (permission === 'unsupported') return setGeoHelp(withSlot({ problem: 'unsupported' as const, field }));
      if (permission === 'granted') {
        const loc = await locate(field, slot);
        if (loc) apply(field, placeFor(loc, slot), slot);
        return;
      }
      // "prompt" — and also "denied", which some browsers report stale: explain
      // first, then really ask; a real refusal then shows how to turn it on.
      setGeoAsk(withSlot({ field }));
    },
    [apply, locate, geoEnv], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const confirmGeo = async () => {
    const ask = geoAsk;
    setGeoAsk(null);
    if (!ask) return;
    const loc = await locate(ask.field, ask.slot);
    if (loc) apply(ask.field, placeFor(loc, ask.slot), ask.slot);
  };

  const retryGeo = async () => {
    const h = geoHelp;
    setGeoHelp(null);
    if (!h) return;
    const loc = await locate(h.field, h.slot);
    if (loc) apply(h.field, placeFor(loc, h.slot), h.slot);
  };

  const pickPlace = (p: Place, kind: Extract<PickedKind, 'search' | 'saved' | 'recent'>) => {
    if (mode.type !== 'pick') return;
    apply(mode.field, { id: p.id, name: p.name, detail: p.detail, location: p.location, kind }, mode.slot);
  };

  const confirmPin = () => {
    if (mode.type !== 'pin') return;
    const loc = { ...mapCenter.current };
    apply(mode.field, { id: pinId(loc), name: t('plan.pinnedPlace'), detail: coordText(loc), location: loc, kind: 'pin' }, mode.slot);
  };

  // One tap on Home / Work / Station: it becomes the destination and, if
  // location is already allowed, the start is filled in from GPS.
  const goSaved = async (p: SavedPlace) => {
    const dest: PickedPlace = { id: p.id, name: p.name, detail: p.detail, location: p.location, kind: 'saved' };
    places.noteUsed(dest);
    setTo(dest);
    if (from) return backToOverview();
    if ((await platform.geoPermission()) === 'granted') {
      const loc = await locate('from');
      if (loc) {
        setFrom({ id: CURRENT_ID, name: t('plan.currentLocation'), detail: '', location: loc, kind: 'current' });
        return backToOverview();
      }
    }
    openPick('from');
  };

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  const departAt = (): Date => (departure.kind === 'now' ? new Date() : instantFromLocal(departure.local, activeCity.timezone));
  const autoMode = useMemo(
    () => modeForTime(departure.kind === 'now' ? new Date() : instantFromLocal(departure.local, activeCity.timezone), from?.location ?? activeCity.center),
    [departure, from],
  );

  const applyIntent = (draft: AgenticIntent) => {
    const suggestedFrom = publicLandmark(draft.from, lang);
    const suggestedTo = publicLandmark(draft.to, lang);
    if (suggestedFrom) setFrom(suggestedFrom);
    if (suggestedTo) setTo(suggestedTo);
    setModeOverride(draft.mode === 'auto' ? null : draft.mode);
    if (draft.time) {
      const today = localInputValue(new Date(), activeCity.timezone).split('T')[0];
      setDeparture({ kind: 'at', local: `${today}T${draft.time}` });
    }
    if (draft.noStairs) setAccess({ stepFree: true });
  };

  // Load the pilot data in the background as soon as both points are known.
  useEffect(() => {
    if (from && to) routing.warm().then(setMeta, () => {});
  }, [from, to]);

  const findRoutes = async (
    at = departAt(), mode = modeOverride ?? autoMode, signal?: AbortSignal,
  ): Promise<Extract<RoutingState, { status: 'done' }> | null> => {
    if (!from || !to || signal?.aborted) return null;
    const run = ++routeRun.current;
    review.reset();
    setReviewFirst(false);
    setMode({ type: 'results' });
    setSnap('half');
    setSelectedRoute(0);
    setRoutingState({ status: 'loading' });
    // Walking only: a trip whose straight line is already past the limit isn't routed.
    if (haversineMeters(from.location, to.location) > activeCity.maxWalkM) {
      setRoutingState({ status: 'error', reason: 'too-far' });
      return null;
    }
    // Cloud cover only matters by day; never let a slow forecast hold up the route.
    const cancel = () => {
      if (run !== routeRun.current) return;
      routeRun.current++;
      setRoutingState(null);
      setMode({ type: 'overview' });
    };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const cloud = mode === 'day'
        ? await Promise.race([weather.cloudCover(at, from.location).catch(() => null), new Promise<null>(resolve => setTimeout(() => resolve(null), 2500))])
        : null;
      if (run !== routeRun.current || signal?.aborted) return null;
      const raw = await routing.route({ from: from.location, to: to.location, departAt: at, mode, cloudCover: cloud, nightFactors: factors, stepFree: access.stepFree }, true);
      // Keep only walks within the limit (a detour for shade can push one over).
      const routes = raw.routes.filter((r) => r.lengthM <= activeCity.maxWalkM);
      if (run !== routeRun.current || signal?.aborted) return null;
      if (!routes.length) {
        setRoutingState({ status: 'error', reason: access.stepFree ? 'too-far-step-free' : 'too-far' });
        return null;
      }
      const done: Extract<RoutingState, { status: 'done' }> = {
        status: 'done', result: { ...raw, routes }, mode, cloud,
        agentRequest: planRequest(from, to, localInputValue(at, activeCity.timezone),
          { mode, language: lang, noStairs: access.stepFree }),
      };
      setRoutingState(done);
      return done;
    } catch (e) {
      if (run === routeRun.current && !signal?.aborted) {
        setRoutingState({ status: 'error', reason: e instanceof RoutingError ? e.reason : 'failed' });
      }
      return null;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  };
  // Judges' demo: plan the sample route straight away, once.
  const demoRan = useRef(false);
  useEffect(() => {
    if (!demo || demoRan.current) return;
    demoRan.current = true;
    void findRoutes();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const navigateTo = useGo();
  const startNavigation = async (signal?: AbortSignal) => {
    if (routingState?.status !== 'done' || !from || !to || signal?.aborted) return false;
    const route = routingState.result.routes[selectedRoute];
    if (!route) return false;
    const run = routeRun.current;
    const guides = await loadGuides().catch(() => []);
    if (signal?.aborted || routeRun.current !== run) return false;
    const all = routingState.result.routes;
    const shortest = all.find((r) => r.kinds.includes('shortest')) ?? all[0]!;
    const baseline = { lengthM: shortest.lengthM, durationS: shortest.durationS, shadeShare: shortest.shadeShare, safetyScore: shortest.safetyScore };
    saveSession({
      ...buildSession(route, routingState.mode, from.location, to.location, guides, to.name, baseline),
      ...(routingState.agentRequest ? { reviewRequest: routingState.agentRequest } : {}),
    });
    navigateTo('/navigate');
    return true;
  };

  const leaveResults = () => {
    routeRun.current++;
    review.reset();
    setRoutingState(null);
    setMode({ type: 'overview' });
    setSnap('half');
  };

  const currentReviewRequest = mode.type === 'results' && routingState?.status === 'done' && routingState.agentRequest
    ? { ...routingState.agentRequest, language: lang } : null;
  const planVoice: VoiceActions = {
    ...routeReviewActions(review, () => currentReviewRequest, async signal => {
      if (mode.type === 'results') return currentReviewRequest;
      return (await findRoutes(undefined, undefined, signal))?.agentRequest ?? null;
    }, () => {
      setReviewFirst(true);
      setSnap('full');
    }),
    plan_trip: async ({ utterance, language }, signal) => {
      const draft = await receiveIntent(utterance, language === 'both' ? lang : language, signal);
      if (signal.aborted || (!draft.from && !draft.to)) return [];
      applyIntent(draft);
      if (mode.type === 'results') leaveResults();
      return speechParts(language, locale => locale === 'th'
        ? 'เติมข้อมูลทริปแล้ว ตรวจสถานที่กับเวลา จากนั้นพูดว่า หาเส้นทาง หรือ ตรวจเส้นทาง'
        : 'I filled in the trip details. Confirm the places and time by saying find routes or review the route.');
    },
    find_routes: async ({ language }, signal) => {
      if (!from || !to) return speechParts(language, locale => locale === 'th'
        ? 'เลือกต้นทางกับปลายทางก่อน หรือบอกทริปเป็นประโยคได้เลย'
        : 'Pick a start and destination, or describe the trip first.');
      if (mode.type === 'results' && routingState?.status === 'loading') return [];
      const done = await findRoutes(undefined, undefined, signal);
      if (signal.aborted) return [];
      return speechParts(language, locale => done
        ? (locale === 'th' ? 'แสดงทางเลือกแล้ว คุณพูดว่า ตรวจเส้นทาง เพื่อดูหลักฐานเพิ่มเติมได้'
          : 'Your route choices are on screen. Say review the route to check the evidence.')
        : (locale === 'th' ? 'ยังหาเส้นทางไม่ได้ ลองตรวจสถานที่บนหน้าจอ' : 'I could not find routes. Check your places on the screen.'));
    },
  };

  const resultsVoice: VoiceActions = {};
  if (mode.type === 'results' && routingState?.status === 'done') {
    const { result, mode: walkMode } = routingState;
    const shortest = result.routes.find(route => route.kinds.includes('shortest'));
    const summary = (routeIndex: number, language: 'th' | 'en' | 'both') => {
      const route = result.routes[routeIndex];
      return route ? verifiedRouteSummary(language, route, walkMode, shortest) : [];
    };
    const choose = (routeIndex: number, language: 'th' | 'en' | 'both') => {
      if (!result.routes[routeIndex]) return [];
      setSelectedRoute(routeIndex);
      return summary(routeIndex, language);
    };
    resultsVoice.ask_trip = ({ language }) => summary(selectedRoute, language);
    resultsVoice.select_route = ({ language, route_ref }) => choose(/^[1-3]$/.test(route_ref)
      ? Number(route_ref) - 1 : result.routes.findIndex(route => route.kinds.some(kind => kind === route_ref)), language);
    resultsVoice.change_route = ({ language, change }) => {
      if (change === 'keep_route') return summary(selectedRoute, language);
      if (change === 'shortest') return choose(shortest ? result.routes.indexOf(shortest) : -1, language);
      if (change === 'prefer_covered') {
        const covered = (i: number) => result.routes[i]!.runs.reduce((length, run) => length + (run.permanent ? run.lengthM : 0), 0);
        const best = result.routes.reduce((index, _, i) => covered(i) > covered(index) ? i : index, selectedRoute);
        return covered(best) > 0 ? choose(best, language) : [];
      }
      if (change === 'avoid_stairs' || change === 'prefer_lit') {
        if (change === 'avoid_stairs') setAccess({ stepFree: true });
        else { setModeOverride('night'); setFactors(['lit']); }
        leaveResults();
        return speechParts(language, locale => locale === 'th'
          ? 'ตั้งค่าแล้ว กดดูเส้นทางใหม่ได้เลย' : 'I updated the preference. Tap See routes to recalculate.');
      }
      return [];
    };
    resultsVoice.start_navigation = async ({ language }, signal) =>
      await startNavigation(signal) ? speechParts(language, locale => locale === 'th'
        ? 'เริ่มนำทางตามเส้นที่เลือกแล้ว' : 'Navigation has started on the selected route.') : [];
  }

  const pickTitle =
    (mode.type === 'pick' || mode.type === 'pin') && mode.slot
      ? t('slot.set', { slot: t(`slot.${mode.slot}`) })
      : t((mode.type === 'pick' || mode.type === 'pin') && mode.field === 'from' ? 'plan.pickFrom' : 'plan.pickTo');

  let header: React.ReactNode;
  let body: React.ReactNode = null;
  if (mode.type === 'results' && routingState) {
    header = <ResultsHeader onBack={leaveResults} mode={routingState.status === 'done' ? routingState.mode : (modeOverride ?? autoMode)} />;
    body = (
      <RouteResults
        state={routingState}
        selected={selectedRoute}
        onSelect={setSelectedRoute}
        onRetry={() => void findRoutes()}
        onChangeTo={() => openPick('to')}
        loadingMode={modeOverride ?? autoMode}
        onStart={() => void startNavigation()}
        meta={meta}
        review={review}
        reviewFirst={reviewFirst}
        trip={from && to ? { from: from.location, to: to.location } : null}
        onLeaveAt={(at) => {
          // An hour already gone today means the same hour tomorrow.
          const when = at.getTime() < Date.now() - 5 * 60_000 ? new Date(at.getTime() + 24 * 3600_000) : at;
          setModeOverride(null);
          setDeparture({ kind: 'at', local: localInputValue(when, activeCity.timezone) });
          void findRoutes(when, modeForTime(when, from?.location ?? activeCity.center));
        }}
      />
    );
  } else if (mode.type === 'pin') {
    header = (
      <div className="pin-head">
        <p className="small">
          {t('plan.pinHint')}
        </p>
        <button type="button" className="btn btn--primary" onClick={confirmPin} data-testid="confirm-pin">
          <MapPin size={22} aria-hidden="true" />
          {t('plan.usePin')}
        </button>
        <button type="button" className="btn btn--text" onClick={() => openPick(mode.field, mode.slot)}>
          {t('common.cancel')}
        </button>
      </div>
    );
  } else if (mode.type === 'pick') {
    header = (
      <PickerHeader
        ref={searchRef}
        title={pickTitle}
        query={query}
        onQuery={setQuery}
        onBack={backToOverview}
        onFocus={() => setSnap('full')}
        autoListen={listenOnOpen}
      />
    );
    body = (
      <PickerBody
        query={query}
        search={search}
        allowCurrent={mode.field === 'from' || !!mode.slot}
        locating={locating}
        saved={mode.slot ? [] : places.saved}
        recents={places.recents}
        onCurrent={() => void useCurrent(mode.field, mode.slot)}
        onPinMode={() => {
          if (mapUnavailable) return toast(t('map.unavailable'));
          setMode({ ...mode, type: 'pin' });
          setSnap('peek');
        }}
        onPick={pickPlace}
      />
    );
  } else {
    header = (
      <div className="plan-head">
        {desktop && (
          <div className="plan-brand">
            <LogoMark size={28} />
            <span>Walk We</span>
          </div>
        )}
        <div className="plan-title-row">
          <h2 className="plan-title">{t('plan.whereTo')}</h2>
          {/* Accessibility, one tap from the planner (lit when anything is on). */}
          <button
            type="button"
            className={`icon-btn plan-access${access.stepFree || access.voice || access.bigText ? ' is-on' : ''}`}
            onClick={() => setAccessOpen(true)}
            aria-label={t('access.title')}
            data-testid="plan-access"
          >
            <Accessibility size={22} aria-hidden="true" />
          </button>
          {voiceOk && (
            <button
              type="button"
              className="icon-btn plan-mic"
              onClick={() => {
                setListenOnOpen(true);
                openPick('to');
              }}
              aria-label={t('plan.voice')}
              data-testid="plan-mic"
            >
              <Mic size={22} aria-hidden="true" />
            </button>
          )}
        </div>
        <RouteCard from={from} to={to} onEdit={(f) => openPick(f)} onSwap={swap} />
      </div>
    );
    body = (
      <>
        <AgenticAsk onDraft={applyIntent} />
        {from && to && (
          <div className="ready fade-in" data-testid="ready" role="status">
            <span className="ready-title">
              <CircleCheck size={22} aria-hidden="true" />
              {t('plan.ready')}
            </span>
            <span className="small">{t('plan.distance', { d: formatDistance(haversineMeters(from.location, to.location), lang) })}</span>
            <WalkTimePanel
              departure={departure}
              onDeparture={setDeparture}
              autoMode={autoMode}
              override={modeOverride}
              onOverride={setModeOverride}
              factors={factors}
              onFactors={setFactors}
              onFind={() => void findRoutes()}
            />
            {to.kind !== 'current' && (
              <button type="button" className="btn btn--ghost" onClick={() => setSaveOpen(true)}>
                {t('plan.saveThis')}
              </button>
            )}
          </div>
        )}
        <SavedSlots saved={places.saved} onGo={(p) => void goSaved(p)} onSet={(slot) => openPick('to', slot)} onRemove={(p) => places.remove(p.slot, p.id)} />
        {places.recents.length > 0 && (
          <section aria-label={t('plan.recent')}>
            <h3 className="section-label">{t('plan.recent')}</h3>
            <ul className="list">
              {places.recents.slice(0, 4).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="row"
                    onClick={() => apply('to', { id: p.id, name: p.name, detail: p.detail, location: p.location, kind: 'recent' })}
                  >
                    <span className="row-ic" aria-hidden="true">
                      <MapPin size={20} />
                    </span>
                    <span className="row-text">
                      <span className="row-title">{p.name}</span>
                      {p.detail && <span className="row-detail">{p.detail}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <details className="settings-more">
          <summary>{t('plan.settingsMore')}</summary>
          <SettingsPanel />
        </details>
      </>
    );
  }

  return (
    <main className="map-screen">
      <header className="topbar">
        {/* On results, the chip names the mode the routes were computed in. */}
        {(() => {
          const m = mode.type === 'results' && routingState?.status === 'done' ? routingState.mode : theme;
          return (
            <span className={`chip chip--${m}`}>
              {m === 'day' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
              {t(m === 'day' ? 'mode.day' : 'mode.night')}
            </span>
          );
        })()}
        {/* SOS (Phase 5) goes top-right, the only control allowed up here. */}
      </header>

      <BottomSheet snap={snap} onSnapChange={setSnap} header={header} onVisibleHeight={setSheetH} label={t('plan.whereTo')}>
        {(mode.type === 'overview' || mode.type === 'results') && <LiveVoice screen="plan"
          actions={{ ...planVoice, ...resultsVoice }} routeReady={routingState?.status === 'done'}
          awaitingReviewChoice={!!review.pendingClarification} />}
        {body}
      </BottomSheet>

      {/* Map after the panel in the DOM (both are positioned): Tab reaches
          the search fields first, then the map and its controls. */}
      {!loadMap ? (
        <div className="map-skeleton" role="status" aria-label={t('common.loading')} />
      ) : mapUnavailable ? (
        <div className="map-fallback">
          <p>{t('map.unavailable')}</p>
        </div>
      ) : (
        <MapBoundary onError={() => setMapUnavailable(true)}>
          <Suspense fallback={<div className="map-skeleton" role="status" aria-label={t('common.loading')} />}>
            <LazyMapView
              theme={theme}
              from={from?.location ?? null}
              to={to?.location ?? null}
              pinMode={mode.type === 'pin'}
              routes={mode.type === 'results' && routingState?.status === 'done' ? routingState.result.routes : null}
              selectedRoute={selectedRoute}
              bottomInset={sheetH}
              topInset={topInset}
              leftInset={leftInset}
              onCenterChange={(c) => (mapCenter.current = c)}
              onUnavailable={() => setMapUnavailable(true)}
              label={t('map.label')}
            />
          </Suspense>
        </MapBoundary>
      )}

      {mode.type === 'pin' && (
        <div aria-hidden="true" style={{ position: 'absolute', left: leftInset, right: 0, top: topInset, bottom: sheetH, pointerEvents: 'none' }}>
          <div className="center-pin" style={{ top: '50%' }}>
            <MapPin size={44} fill="currentColor" stroke="var(--surface)" strokeWidth={1.5} />
          </div>
        </div>
      )}

      {geoAsk && (
        <Dialog
          title={t('geo.title')}
          icon={<LocateFixed size={28} aria-hidden="true" />}
          onClose={() => setGeoAsk(null)}
          actions={
            <>
              <button type="button" className="btn btn--primary" onClick={() => void confirmGeo()} data-testid="geo-allow">
                {t('geo.allow')}
              </button>
              <button type="button" className="btn btn--text" onClick={() => setGeoAsk(null)}>
                {t('geo.notNow')}
              </button>
            </>
          }
        >
          <p className="sub">{t('geo.body')}</p>
        </Dialog>
      )}

      {geoHelp && (
        <GeoHelp
          problem={geoHelp.problem}
          env={geoEnv}
          onRetry={() => void retryGeo()}
          onInstead={() => {
            setGeoHelp(null);
            requestAnimationFrame(() => searchRef.current?.focus());
          }}
        />
      )}

      {accessOpen && (
        <Dialog
          title={t('access.title')}
          icon={<Accessibility size={28} />}
          onClose={() => setAccessOpen(false)}
          actions={
            <button type="button" className="btn btn--primary" onClick={() => setAccessOpen(false)}>
              {t('access.done')}
            </button>
          }
        >
          <AccessPanel />
        </Dialog>
      )}

      {saveOpen && to && (
        <Dialog
          title={t('slot.saveAs')}
          onClose={() => setSaveOpen(false)}
          actions={
            <>
              {SLOTS.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  className="btn"
                  onClick={() => {
                    places.save(to, slot);
                    setSaveOpen(false);
                    toast(t('slot.saved', { slot: t(`slot.${slot}`) }));
                  }}
                >
                  {t(`slot.${slot}`)}
                </button>
              ))}
              <button type="button" className="btn btn--text" onClick={() => setSaveOpen(false)}>
                {t('common.cancel')}
              </button>
            </>
          }
        >
          <p className="sub">{to.name}</p>
        </Dialog>
      )}
    </main>
  );
}
