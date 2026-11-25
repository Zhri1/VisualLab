import type { Motion } from "../../types";
import { systemEnergyAt } from "./systemEnergy";

const j = (v: number) => (Math.abs(v) < 5e-4 ? "0" : v.toFixed(2));

/** 堆叠能量条：动能/重力势/弹性势/耗散，同钟实时；多物体用系统能量估算。 */
export function EnergyBar({ motion, time }: { motion: Motion; time: number }) {
  const native = motion.energyAt?.(time);
  const sys = native
    ? {
        kineticJ: native.kineticJ,
        gravityJ: native.gravitationalPotentialJ ?? 0,
        elasticJ: native.elasticPotentialJ ?? 0,
        dissipatedJ: native.frictionHeatJ,
        totalJ: native.kineticJ + (native.gravitationalPotentialJ ?? 0) + (native.elasticPotentialJ ?? 0) + native.frictionHeatJ,
      }
    : systemEnergyAt(motion, time);
  if (!sys) return null;
  const total = Math.max(sys.totalJ, 1e-6);
  const parts: Array<[string, number, string]> = [
    ["动能", sys.kineticJ, "kinetic"],
    ["重力势", sys.gravityJ, "gravity"],
    ["弹性势", sys.elasticJ, "elastic"],
    ["耗散", sys.dissipatedJ, "heat"],
  ];
  return (
    <div className="energy-bar" data-testid="energy-bar" aria-label="能量流向条">
      <div className="energy-bar-track">
        {parts.map(([name, v, key]) =>
          v > 1e-6 ? <span key={key} className={`energy-seg energy-${key}`} style={{ width: `${(v / total) * 100}%` }} title={`${name} ${j(v)} J`} /> : null
        )}
      </div>
      <div className="energy-bar-legend">
        {parts.map(([name, v, key]) => (
          <span key={key} className={`energy-key energy-${key}`}>
            {name} <b>{j(v)}</b> J
          </span>
        ))}
      </div>
    </div>
  );
}
