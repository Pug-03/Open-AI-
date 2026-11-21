import { activeCity } from '@walkwe/config';
import { Area, AreaRouter } from '@walkwe/core';
import { toAreaInput, type AreaDataset, type IncidentsDataset } from '@walkwe/data';

export function createPilotRouter(dataset: AreaDataset, incidents: IncidentsDataset | null) {
  const area = new Area(toAreaInput(dataset, (incidents?.items ?? []).map((item) => ({
    id: item.id, wayIds: item.wayIds, category: item.category, occurredOn: item.occurredOn,
    window: item.window, severity: item.severity,
  }))));
  return new AreaRouter(area, {
    timeZone: activeCity.timezone,
    defaultMallHours: activeCity.defaultMallHours,
    walkSpeedMps: activeCity.walkSpeedMps,
    incidents: { halfLifeDays: activeCity.incidents.halfLifeDays, outsideWindow: activeCity.incidents.outsideWindow },
  });
}
