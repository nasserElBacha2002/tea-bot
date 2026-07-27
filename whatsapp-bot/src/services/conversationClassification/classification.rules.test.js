import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accumulateNodeDimensions,
  buildPrimaryQueryFromDimensions,
  isGenericNode,
} from './classification.rules.js';

const paths = [
  ['no_pd_informes', 'presencial', 'periodismo_deportivo', 'informes'],
  ['no_pd_charla', 'presencial', 'periodismo_deportivo', 'charla'],
  ['no_pg_informes', 'presencial', 'periodismo_general', 'informes'],
  ['no_pg_charla', 'presencial', 'periodismo_general', 'charla'],
  ['no_cursos_info', null, 'curso', null],
  ['no_dist_informes', 'distancia', null, 'informes'],
  ['no_dist_charla', 'distancia', null, 'charla'],
  ['si_pd_informes', 'presencial', 'periodismo_deportivo', 'informes'],
  ['si_pg_informes', 'presencial', 'periodismo_general', 'informes'],
];

for (const [nodeSuffix, modality, programNameOrType, reason] of paths) {
  test(`accumulateNodeDimensions cubre ${nodeSuffix}`, () => {
    const nodeId = nodeSuffix.startsWith('no_') || nodeSuffix.startsWith('si_')
      ? nodeSuffix
      : `no_${nodeSuffix}`;
    const visitedNodes = ['welcome', 'no_menu', nodeId, 'human_handoff'];
    const dimensions = accumulateNodeDimensions(visitedNodes, 'main-menu', 'v11');

    if (modality) assert.equal(dimensions.modality, modality);
    if (programNameOrType === 'curso') {
      assert.equal(dimensions.programType, 'curso');
    } else if (programNameOrType) {
      assert.equal(dimensions.programName, programNameOrType);
    }
    if (reason) assert.equal(dimensions.specificReason, reason);
    assert.ok(buildPrimaryQueryFromDimensions(dimensions));
  });
}

test('isGenericNode ignora human_handoff y welcome', () => {
  assert.equal(isGenericNode('human_handoff'), true);
  assert.equal(isGenericNode('welcome'), true);
  assert.equal(isGenericNode('no_pd_informes'), false);
});
