import {describe, it, expect} from 'vitest';
import {render} from 'vitest-browser-svelte';
import type {AbiParameter} from 'viem';
import FunctionInputs from '../../../src/routes/contracts/components/FunctionInputs.svelte';

const inputs = [
	{type: 'uint256', name: 'amount'},
	{type: 'bool', name: 'flag'},
] as AbiParameter[];

/** Each label of the container names an element of the same container. */
function labelsTargetTheirOwnForm(container: HTMLElement): boolean {
	const labels = [...container.querySelectorAll('label')];
	return (
		labels.length === inputs.length &&
		labels.every((label) => {
			const target = document.getElementById(label.htmlFor);
			return target !== null && container.contains(target);
		})
	);
}

describe('FunctionInputs.svelte', () => {
	it('keeps the ids `input-<index>` without a prefix', async () => {
		const screen = await render(FunctionInputs, {
			inputs,
			values: {},
			errors: {},
		});
		expect(screen.container.querySelector('#input-0')).not.toBeNull();
		expect(screen.container.querySelector('#input-1')).not.toBeNull();
	});

	it('gives two forms on one page distinct ids, each label focusing its own input', async () => {
		const first = await render(FunctionInputs, {
			inputs,
			values: {},
			errors: {},
			idPrefix: '0xaaaa-transfer(uint256,bool)-',
		});
		const second = await render(FunctionInputs, {
			inputs,
			values: {},
			errors: {},
			idPrefix: '0xbbbb-transfer(uint256,bool)-',
		});

		expect(labelsTargetTheirOwnForm(first.container)).toBe(true);
		expect(labelsTargetTheirOwnForm(second.container)).toBe(true);
		const ids = [...document.querySelectorAll('input, select')].map(
			(element) => element.id,
		);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
