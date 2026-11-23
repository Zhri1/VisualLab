import type { Motion } from "../../../types";

const joule = (value: number) => (Math.abs(value) < 5e-5 ? "0" : value.toFixed(3));

/** 与画布共用播放时钟的能量读数：动能、相关势能、累计已知摩擦耗能。条件不足（null）时不渲染。 */
export function energyText(motion: Motion, time: number): string | null {
  const reading = motion.energyAt?.(time);
  if (!reading) return null;
  const parts = [`动能 ${joule(reading.kineticJ)} J`];
  if (reading.elasticPotentialJ !== null) parts.push(`弹性势能 ${joule(reading.elasticPotentialJ)} J`);
  if (reading.gravitationalPotentialJ !== null) parts.push(`重力势能 ${joule(reading.gravitationalPotentialJ)} J`);
  parts.push(`累计摩擦耗能 ${joule(reading.frictionHeatJ)} J${reading.priorFrictionKnown ? "" : "（自此起计）"}`);
  return parts.join("，");
}

/** 只在含弹簧阶段的计划里显示，避免改动其他题型的既有画面。 */
export function showsEnergy(motion: Motion): boolean {
  return !!motion.energyAt && !!motion.stagePlan?.stages.some((stage) => stage.kind === "spring_contact" || stage.kind === "spring_release");
}

export function EnergyReadout({ motion, time }: { motion: Motion; time: number }) {
  if (!showsEnergy(motion)) return null;
  const reading = motion.energyAt!(time);
  if (!reading) return null;
  const items: Array<[string, string, string]> = [["动能", joule(reading.kineticJ), "kinetic"]];
  if (reading.elasticPotentialJ !== null) items.push(["弹性势能", joule(reading.elasticPotentialJ), "elastic"]);
  if (reading.gravitationalPotentialJ !== null) items.push(["重力势能", joule(reading.gravitationalPotentialJ), "gravity"]);
  items.push([reading.priorFrictionKnown ? "累计摩擦耗能" : "摩擦耗能（自此起计）", joule(reading.frictionHeatJ), "heat"]);
  return (
    <div className="energy-readout" data-testid="energy-readout" aria-hidden="true">
      {items.map(([name, value, key]) => (
        <span key={key} className="energy-item" data-energy={key}>{name} <b>{value}</b> J</span>
      ))}
    </div>
  );
}
