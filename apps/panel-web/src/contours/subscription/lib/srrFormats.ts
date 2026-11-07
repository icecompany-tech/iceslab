import { FORMAT_NAMES } from '@iceslab/shared';
import type { SubscriptionFormat } from '@/lib/old/srr';

/** The contract's list: a copy here drifted silently and cost a 400 on save. */
export const SRR_FORMATS: readonly SubscriptionFormat[] = FORMAT_NAMES;

/** A balancer cascade survives only in a format that expands one entry into a server per exit. */
export const CASCADE_AWARE_FORMATS: SubscriptionFormat[] = ['plain'];
