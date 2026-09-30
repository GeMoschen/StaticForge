import '@angular/compiler';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuleEvaluationRequest, RuleEvaluationView, RuleEvaluator } from './rule-evaluator';

const view = (message: string): RuleEvaluationView => ({
  findings: [{ path: 'content.title', message, severity: 'WARNING' }],
  fills: [],
  fieldStates: [],
});

const request = (title: string) => (): RuleEvaluationRequest => ({ kind: 'PAGE', content: { title } as never });

describe('RuleEvaluator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces: only the last of quick changes is sent', () => {
    const send = vi.fn((r: RuleEvaluationRequest) => of(view(String((r.content as unknown as { title: string }).title))));
    const evaluator = new RuleEvaluator(send, 400);

    evaluator.request(request('a'));
    vi.advanceTimersByTime(200);
    evaluator.request(request('ab'));
    vi.advanceTimersByTime(399);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(send).toHaveBeenCalledTimes(1);
    expect(evaluator.result()?.findings?.[0].message).toBe('ab');
  });

  it('drops an answer that arrives after a newer request was sent', () => {
    const first = new Subject<RuleEvaluationView>();
    const second = new Subject<RuleEvaluationView>();
    const answers = [first, second];
    const onResult = vi.fn();
    const evaluator = new RuleEvaluator(() => answers.shift()!, 400, onResult);

    evaluator.now(request('old'));
    evaluator.now(request('new'));
    second.next(view('new'));
    first.next(view('old'));

    expect(evaluator.result()?.findings?.[0].message).toBe('new');
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it('keeps the last good answer when a request fails, and skips an empty request', () => {
    const responses = [of(view('good')), throwError(() => new Error('429'))];
    const send = vi.fn(() => responses.shift()!);
    const evaluator = new RuleEvaluator(send, 400);

    evaluator.now(request('x'));
    evaluator.now(request('y'));
    evaluator.now(() => null);

    expect(send).toHaveBeenCalledTimes(2);
    expect(evaluator.result()?.findings?.[0].message).toBe('good');
  });

  it('forgets its result on reset and ignores an answer to a request made before', () => {
    const pending = new Subject<RuleEvaluationView>();
    const evaluator = new RuleEvaluator(() => pending, 400);
    evaluator.now(request('x'));
    evaluator.reset();
    pending.next(view('late'));
    expect(evaluator.result()).toBeNull();
  });
});
