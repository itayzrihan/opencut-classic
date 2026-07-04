"use client";

import { resolveAnimationPathValueAtTime } from "@/animation";
import { Section, SectionContent, SectionFields } from "@/components/section";
import { useEditor } from "@/editor/use-editor";
import { useElementPlayhead } from "@/components/editor/panels/properties/hooks/use-element-playhead";
import { useKeyframedParamProperty } from "@/components/editor/panels/properties/hooks/use-keyframed-param-property";
import { PropertyParamField } from "@/components/editor/panels/properties/components/property-param-field";
import type { ParamValue, ParamValues } from "@/params";
import {
	getElementParams,
	readElementParamValue,
	writeElementParamValue,
	type ElementParamDefinition,
} from "@/params/registry";
import type { TimelineElement } from "@/timeline";
import type { MediaTime } from "@/wasm";

export type ElementWithTrackForParams = {
	track: { id: string };
	element: TimelineElement;
};

export function ElementParamsTab({
	element,
	trackId,
	elementsWithTracks,
	paramKeys,
	sectionKey,
}: {
	element: TimelineElement;
	trackId: string;
	elementsWithTracks?: ElementWithTrackForParams[];
	paramKeys?: readonly string[];
	sectionKey: string;
}) {
	const { localTime, isPlayheadWithinElementRange } = useElementPlayhead({
		startTime: element.startTime,
		duration: element.duration,
	});
	const params = getElementParams({ element }).filter(
		(param) => !paramKeys || paramKeys.includes(param.key),
	);
	const baseValues = buildValues({ element, params });
	const bulkElements =
		elementsWithTracks && elementsWithTracks.length > 1
			? elementsWithTracks
			: null;

	return (
		<Section sectionKey={`${element.id}:${sectionKey}`}>
			<SectionContent className="pt-4">
				<SectionFields>
					{params
						.filter((param) => isVisible({ param, values: baseValues }))
						.map((param) => (
							<ElementParamField
								key={param.key}
								element={element}
								trackId={trackId}
								elementsWithTracks={bulkElements ?? undefined}
								param={param}
								baseValue={baseValues[param.key] ?? param.default}
								isMixed={
									bulkElements
										? isMixedParamValue({
												elementsWithTracks: bulkElements,
												param,
											})
										: false
								}
								localTime={localTime}
								isPlayheadWithinElementRange={isPlayheadWithinElementRange}
							/>
						))}
				</SectionFields>
			</SectionContent>
		</Section>
	);
}

function ElementParamField({
	element,
	trackId,
	elementsWithTracks,
	param,
	baseValue,
	isMixed,
	localTime,
	isPlayheadWithinElementRange,
}: {
	element: TimelineElement;
	trackId: string;
	elementsWithTracks?: ElementWithTrackForParams[];
	param: ElementParamDefinition;
	baseValue: ParamValue;
	isMixed: boolean;
	localTime: MediaTime;
	isPlayheadWithinElementRange: boolean;
}) {
	const resolvedValue = resolveAnimationPathValueAtTime({
		animations: element.animations,
		propertyPath: param.key,
		localTime,
		fallbackValue: baseValue,
	});
	const animatedParam = useKeyframedParamProperty({
		param,
		trackId,
		elementId: element.id,
		animations: element.animations,
		propertyPath: param.key,
		localTime,
		isPlayheadWithinElementRange,
		resolvedValue,
		buildBaseUpdates: ({ value }) =>
			writeElementParamValue({ element, param, value }),
	});
	const editor = useEditor();
	const isBulk = !!elementsWithTracks?.length;

	const onPreview = (value: ParamValue) => {
		if (!elementsWithTracks) {
			animatedParam.onPreview(value);
			return;
		}

		editor.timeline.previewElements({
			updates: elementsWithTracks.map((entry) => ({
				trackId: entry.track.id,
				elementId: entry.element.id,
				updates: writeElementParamValue({
					element: entry.element,
					param,
					value,
				}),
			})),
		});
	};

	const onCommit = () => editor.timeline.commitPreview();

	return (
		<PropertyParamField
			param={param}
			value={resolvedValue}
			isMixed={isMixed}
			onPreview={onPreview}
			onCommit={isBulk ? onCommit : animatedParam.onCommit}
			keyframe={
				isBulk || param.keyframable === false
					? undefined
					: {
							isActive: animatedParam.isKeyframedAtTime,
							isDisabled: !isPlayheadWithinElementRange,
							onToggle: animatedParam.toggleKeyframe,
						}
			}
		/>
	);
}

function buildValues({
	element,
	params,
}: {
	element: TimelineElement;
	params: readonly ElementParamDefinition[];
}): ParamValues {
	const values: ParamValues = {};
	for (const param of params) {
		const value = readElementParamValue({ element, param });
		if (value !== null) {
			values[param.key] = value;
		}
	}
	return values;
}

function isMixedParamValue({
	elementsWithTracks,
	param,
}: {
	elementsWithTracks: ElementWithTrackForParams[];
	param: ElementParamDefinition;
}) {
	const first = readElementParamValue({
		element: elementsWithTracks[0].element,
		param,
	});
	return elementsWithTracks.some((entry) => (
		readElementParamValue({ element: entry.element, param }) !== first
	));
}

function isVisible({
	param,
	values,
}: {
	param: ElementParamDefinition;
	values: ParamValues;
}): boolean {
	return (param.dependencies ?? []).every((dependency) =>
		areParamValuesEqual({
			left: values[dependency.param],
			right: dependency.equals,
		}),
	);
}

function areParamValuesEqual({
	left,
	right,
}: {
	left: ParamValue | undefined;
	right: ParamValue;
}): boolean {
	return left === right;
}
