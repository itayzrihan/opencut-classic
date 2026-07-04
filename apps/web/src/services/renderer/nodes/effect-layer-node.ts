import type { EffectPass } from "@/effects/types";
import type { ParamValues } from "@/params";
import { BaseNode } from "./base-node";

export type EffectLayerNodeParams = {
	effectType: string;
	effectParams: ParamValues;
	timeOffset: number;
	duration: number;
};

export type ResolvedEffectLayerNodeState = {
	passes: EffectPass[];
	overlay: EffectLayerOverlay | null;
};

export type EffectLayerOverlay = {
	label: string;
	intent?: string;
};

export class EffectLayerNode extends BaseNode<
	EffectLayerNodeParams,
	ResolvedEffectLayerNodeState
> {}
