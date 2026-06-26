import type { CustomerAccountFeatureConfig } from "@/lib/customer-accounts";

export type CustomerSessionTimeoutReason =
  | "active"
  | "idle_expired"
  | "absolute_expired"
  | "revoked"
  | "missing"
  | "invalid";

export type CustomerSessionTimeoutInput = {
  lastActivityAt: Date;
  absoluteExpiresAt: Date;
  revokedAt?: Date | null;
};

export type CustomerSessionTimeoutState = {
  reason: CustomerSessionTimeoutReason;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  warningStartsAt: Date;
  millisecondsUntilIdleExpiration: number;
  millisecondsUntilAbsoluteExpiration: number;
};

function msFromMinutes(minutes: number) {
  return Math.max(1, minutes) * 60 * 1000;
}

function msFromHours(hours: number) {
  return Math.max(1, hours) * 60 * 60 * 1000;
}

function msFromSeconds(seconds: number) {
  return Math.max(1, seconds) * 1000;
}

export function customerSessionAbsoluteExpiresAt(config: CustomerAccountFeatureConfig, now = new Date()) {
  return new Date(now.getTime() + msFromHours(config.customerSessionAbsoluteTimeoutHours));
}

export function customerSessionIdleExpiresAt(
  config: Pick<CustomerAccountFeatureConfig, "customerSessionIdleTimeoutMinutes">,
  lastActivityAt: Date
) {
  return new Date(lastActivityAt.getTime() + msFromMinutes(config.customerSessionIdleTimeoutMinutes));
}

export function resolveCustomerSessionTimeout(
  config: Pick<CustomerAccountFeatureConfig, "customerSessionIdleTimeoutMinutes" | "customerSessionWarningSeconds">,
  session: CustomerSessionTimeoutInput | null | undefined,
  now = new Date()
): CustomerSessionTimeoutState {
  const fallbackDate = now;
  if (!session) {
    return {
      reason: "missing",
      idleExpiresAt: fallbackDate,
      absoluteExpiresAt: fallbackDate,
      warningStartsAt: fallbackDate,
      millisecondsUntilIdleExpiration: 0,
      millisecondsUntilAbsoluteExpiration: 0
    };
  }

  const idleExpiresAt = customerSessionIdleExpiresAt(config, session.lastActivityAt);
  const warningStartsAt = new Date(idleExpiresAt.getTime() - msFromSeconds(config.customerSessionWarningSeconds));
  const millisecondsUntilIdleExpiration = idleExpiresAt.getTime() - now.getTime();
  const millisecondsUntilAbsoluteExpiration = session.absoluteExpiresAt.getTime() - now.getTime();

  let reason: CustomerSessionTimeoutReason = "active";
  if (session.revokedAt) {
    reason = "revoked";
  } else if (millisecondsUntilAbsoluteExpiration <= 0) {
    reason = "absolute_expired";
  } else if (millisecondsUntilIdleExpiration <= 0) {
    reason = "idle_expired";
  }

  return {
    reason,
    idleExpiresAt,
    absoluteExpiresAt: session.absoluteExpiresAt,
    warningStartsAt,
    millisecondsUntilIdleExpiration,
    millisecondsUntilAbsoluteExpiration
  };
}

export function shouldTouchCustomerSessionActivity(
  config: Pick<CustomerAccountFeatureConfig, "customerSessionActivityTouchIntervalSeconds">,
  lastActivityAt: Date,
  now = new Date()
) {
  return now.getTime() - lastActivityAt.getTime() >= msFromSeconds(config.customerSessionActivityTouchIntervalSeconds);
}
