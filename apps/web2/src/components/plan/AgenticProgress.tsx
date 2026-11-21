import './agentic-progress.css';

const stageOrder = ['routes', 'evidence', 'review', 'critique'] as const;
type Stage = typeof stageOrder[number];
type StageEvent = 'working' | 'done' | 'fallback';
type StageState = StageEvent | 'pending' | 'skipped' | 'interrupted';

export type AgenticProgressStages = Partial<Record<Stage, StageEvent>>;

const copy = {
  th: {
    label: 'ขั้นตอนตรวจเส้นทาง',
    stages: {
      routes: { title: 'คำนวณเส้นทาง', actor: 'ระบบแผนที่ Walk We' },
      evidence: { title: 'รวบรวมหลักฐาน', actor: 'ข้อมูลแผนที่และข้อมูลไฟที่ตรวจแล้ว' },
      review: { title: 'ตรวจข้อเสนอ', actor: 'AI เสนอทาง แล้ว Walk We เช็กกับข้อมูล' },
      critique: { title: 'ทบทวนเพิ่มเติม', actor: 'AI อีกตัวช่วยตรวจเมื่อจำเป็น' },
    },
    status: { working: 'กำลังทำ', done: 'เสร็จแล้ว', fallback: 'ใช้วิธีสำรอง', pending: 'รอเริ่ม', skipped: 'ไม่ได้ใช้', interrupted: 'ยังไม่เสร็จ' },
  },
  en: {
    label: 'Route review steps',
    stages: {
      routes: { title: 'Calculate routes', actor: 'Walk We maps' },
      evidence: { title: 'Collect route evidence', actor: 'Map data and reviewed lighting reports' },
      review: { title: 'Verify the suggestion', actor: 'AI suggests a route. Walk We checks it.' },
      critique: { title: 'Review again', actor: 'A second AI checks when needed' },
    },
    status: { working: 'In progress', done: 'Complete', fallback: 'Used fallback', pending: 'Pending', skipped: 'Skipped', interrupted: 'Unfinished' },
  },
} satisfies Record<'th' | 'en', { label: string; stages: Record<Stage, { title: string; actor: string }>; status: Record<StageState, string> }>;

interface Props {
  lang: 'th' | 'en';
  stages: AgenticProgressStages;
  busy: boolean;
  source?: 'worker' | 'verified_planner';
  failed?: boolean;
}

export function AgenticProgress({ lang, stages, busy, source, failed }: Props) {
  const labels = copy[lang];
  const current = busy ? stageOrder.find(stage => stages[stage] === 'working') : undefined;
  const finished = !busy && (source || failed);

  return (
    <div className="agentic-progress">
      <span className="sr-only" role="status">
        {current ? `${labels.stages[current].title} ${labels.status.working}` : ''}
      </span>
      <ol className="agentic-progress-rail" aria-label={labels.label} role="list">
        {stageOrder.map(stage => {
          const observed = stages[stage];
          const state: StageState = !busy && observed === 'working'
            ? 'interrupted'
            : (observed ?? (finished ? 'skipped' : 'pending'));
          const { title, actor } = labels.stages[stage];
          return (
            <li key={stage} data-stage={stage} data-stage-state={state} aria-current={stage === current ? 'step' : undefined}>
              <span className="agentic-progress-stop" aria-hidden="true" />
              <span className="agentic-progress-description">
                <strong>{title}</strong>
                <span>{actor}</span>
              </span>
              <span className="agentic-progress-status">{labels.status[state]}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
