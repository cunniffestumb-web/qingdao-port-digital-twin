import { STAGES } from './domain.mjs';

function summary(samples) {
  if (!samples.length) return { mean: 0, p50: 0, p95: 0, max: 0 };
  const ordered = [...samples].sort((a, b) => a - b);
  const rank = percentile => ordered[Math.ceil(ordered.length * percentile) - 1];
  return {
    mean: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    p50: rank(0.5),
    p95: rank(0.95),
    max: ordered.at(-1),
  };
}

function blankFlow() {
  return { total: 0, completed: 0, active: 0, waiting: 0, scheduled: 0 };
}

function groupFor(groups, kind) {
  if (!groups.has(kind)) groups.set(kind, { kind, total: 0, busy: 0, fault: 0, waiting: 0, busyTime: 0 });
  return groups.get(kind);
}

// All times are seconds. A pre-service wait includes positioning after dispatch.
// Current waits accrue through the observed time. Zero waits count in both means.
export function analyze({ time, containers, resources }) {
  const stages = new Map(Object.values(STAGES).map(({ id, label }) => [id, {
    id, label, waiting: 0, active: 0, completed: 0, waitTime: 0, waitCount: 0,
  }]));
  const flow = { export: blankFlow(), import: blankFlow() };
  const groups = new Map();
  const overdue = [];
  const waits = [];
  const durations = [];
  const completions = new Map([[0, 0], [time, 0]]);

  for (const resource of resources) {
    const group = groupFor(groups, resource.kind);
    group.total++;
    if (resource.status === 'busy') group.busy++;
    if (resource.status === 'fault') group.fault++;
    group.busyTime += resource.busyTime;
  }

  for (const cargo of containers) {
    const { id, direction, status, stage, release, due, completedAt, history } = cargo;
    flow[direction].total++;
    flow[direction][status]++;
    if (status === 'scheduled') continue;

    if (status === 'completed') {
      durations.push(completedAt - release);
      completions.set(completedAt, (completions.get(completedAt) ?? 0) + 1);
    } else if (time > due) {
      overdue.push({ id, due, lateBy: time - due, status });
    }

    const current = stages.get(stage);
    if (current && (status === 'waiting' || status === 'active')) current[status]++;
    if (status === 'waiting' || cargo.phase === 'awaiting-permit') {
      const blockers = new Set((cargo.waitingFor ?? []).map(blocker => blocker.kind));
      for (const kind of blockers) groupFor(groups, kind).waiting++;
    }

    const awaiting = new Map();
    let totalWait = 0;
    for (const event of history) {
      const step = stages.get(event.stage);
      if (!step) continue;
      if (event.type === 'wait') awaiting.set(event.stage, event.time);
      if (event.type === 'finish') step.completed++;
      if (event.type === 'start' && awaiting.has(event.stage)) {
        const elapsed = event.time - awaiting.get(event.stage);
        step.waitCount++;
        step.waitTime += elapsed;
        totalWait += elapsed;
        awaiting.delete(event.stage);
      }
    }
    if (current && awaiting.has(stage)) {
      const elapsed = time - awaiting.get(stage);
      current.waitCount++;
      current.waitTime += elapsed;
      totalWait += elapsed;
    }
    waits.push(totalWait);
  }

  let completed = 0;
  const timeline = [...completions].sort(([a], [b]) => a - b).map(([time, delta]) => {
    completed += delta;
    return { time, completed };
  });
  const unreleased = flow.export.scheduled + flow.import.scheduled;
  const bottlenecks = Array.from(groups.values(), ({ busyTime, ...group }) => ({
    ...group,
    utilization: group.total && time ? busyTime / (group.total * time) : 0,
  })).sort((a, b) => b.waiting - a.waiting || b.utilization - a.utilization || a.kind.localeCompare(b.kind));

  return {
    stages: Array.from(stages.values(), ({ waitTime, waitCount, ...stage }) => ({
      ...stage,
      avgWait: waitCount ? waitTime / waitCount : 0,
    })),
    flow,
    wait: summary(waits),
    duration: { ...summary(durations), sampleSize: durations.length },
    bottlenecks,
    overdue: overdue.sort((a, b) => b.lateBy - a.lateBy || a.id.localeCompare(b.id)),
    counts: { total: containers.length, completed, unreleased, workInProgress: containers.length - completed - unreleased },
    timeline,
  };
}
