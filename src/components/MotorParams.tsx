import { NumberField } from "./NumberField";
import { useTelemetry } from "../telemetry/TelemetryContext";

/**
 * Motor constants (KV, winding resistance, gearbox reduction) shared between
 * the live and analysis pages. They feed the RPM estimate and persist via the
 * telemetry config, so a value set on one page is remembered on the other.
 */
export function MotorParams() {
  const { config, setConfig } = useTelemetry();
  return (
    <div className="nt-params">
      <NumberField
        label="KV do motor"
        value={config.kv}
        min={0}
        placeholder="100"
        hint="rpm / volt"
        onValueChange={(kv) => setConfig({ kv })}
      />
      <NumberField
        label="Resistência"
        value={config.resistance}
        min={0}
        placeholder="0.10"
        hint="ohms (Ω)"
        onValueChange={(resistance) => setConfig({ resistance })}
      />
      <NumberField
        label="Redução"
        value={config.reduction}
        min={0}
        placeholder="1"
        hint="motor : eixo"
        onValueChange={(reduction) => setConfig({ reduction })}
      />
    </div>
  );
}
