import React, { useState } from 'react';
import { Button, Collapse, Input, Modal, Select, Tooltip, Typography, message } from 'antd';
import { ApiOutlined, BulbOutlined, CopyOutlined } from '@ant-design/icons';
import { TRAINING_ENDPOINT, buildTrainingPostBody, saveTrainingRecipe, type TrainingRecipe } from './aiTraining';

const { Text } = Typography;

const MODULE_OPTIONS = ['GL', 'AP', 'AR', 'CASH', 'FA', 'PC', 'PROC', 'RM', 'PMS', 'OTHER']
  .map(m => ({ value: m, label: m }));

/**
 * "Teach AI" — capture the search/call a page just ran as a training recipe
 * for the AI Assistant. Pages pass a buildRecipe() that snapshots their
 * current request (URL template, params, example values); the user reviews,
 * names it, and saves. The assistant knows it from the next message on.
 */
const TeachAIButton: React.FC<{
  buildRecipe: () => TrainingRecipe | null;
  size?: 'small' | 'middle';
}> = ({ buildRecipe, size = 'small' }) => {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recipe, setRecipe] = useState<TrainingRecipe | null>(null);

  const start = () => {
    const r = buildRecipe();
    if (!r) {
      message.info('Run a search first — Teach AI captures the exact call the page just made.');
      return;
    }
    setRecipe(r);
    setOpen(true);
  };

  const save = async () => {
    if (!recipe?.recipeName?.trim()) { message.warning('Give the recipe a name'); return; }
    setSaving(true);
    const res = await saveTrainingRecipe(recipe);
    setSaving(false);
    if (res.ok) {
      message.success('Taught! The AI Assistant can use this from its next message.');
      setOpen(false);
    } else {
      message.error(`Could not save recipe: ${res.message}`);
    }
  };

  const exampleQs = recipe?.example && Object.keys(recipe.example).length
    ? new URLSearchParams(recipe.example).toString()
    : '';

  return (
    <>
      <Tooltip title="Teach the AI Assistant this search — it will learn the webservice and its parameters">
        <Button size={size} icon={<BulbOutlined />} onClick={start} style={{ color: '#7B5EA7' }}>
          Teach AI
        </Button>
      </Tooltip>
      <Modal
        title={<span><BulbOutlined style={{ color: '#7B5EA7' }} /> Teach the AI Assistant</span>}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={save}
        okText="Save recipe"
        confirmLoading={saving}
        width={620}
      >
        {recipe && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <Text strong style={{ fontSize: 12 }}>Recipe name</Text>
              <Input value={recipe.recipeName}
                onChange={e => setRecipe({ ...recipe, recipeName: e.target.value })} />
            </div>
            <div>
              <Text strong style={{ fontSize: 12 }}>When should the assistant use it? (phrases, intent)</Text>
              <Input.TextArea rows={2} value={recipe.description}
                onChange={e => setRecipe({ ...recipe, description: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div>
                <Text strong style={{ fontSize: 12 }}>Module</Text><br />
                <Select style={{ width: 120 }} options={MODULE_OPTIONS} value={recipe.module}
                  onChange={v => setRecipe({ ...recipe, module: v })} />
              </div>
              <div style={{ flex: 1 }}>
                <Text strong style={{ fontSize: 12 }}>Webservice</Text>
                <Input value={`${recipe.method} ${recipe.urlTemplate}`} readOnly />
              </div>
            </div>
            <div>
              <Text strong style={{ fontSize: 12 }}>Parameters captured ({(recipe.params || []).length})</Text>
              <div style={{ background: '#FAFAFA', border: '1px solid #EEE', borderRadius: 8, padding: '6px 10px', fontSize: 12, maxHeight: 140, overflowY: 'auto' }}>
                {(recipe.params || []).map(p => (
                  <div key={p.name}>
                    <Text code>{p.name}</Text>{p.required ? ' *' : ''} — {p.label || p.name}
                    {recipe.example?.[p.name] !== undefined && (
                      <Text type="secondary"> (e.g. {recipe.example[p.name]})</Text>
                    )}
                  </div>
                ))}
                {!(recipe.params || []).length && <Text type="secondary">No parameters</Text>}
              </div>
            </div>
            {exampleQs && (
              <Text type="secondary" style={{ fontSize: 11, wordBreak: 'break-all' }}>
                Example captured: ?{exampleQs}
              </Text>
            )}
            <Collapse
              ghost
              size="small"
              items={[{
                key: 'api',
                label: <span style={{ fontSize: 12 }}><ApiOutlined /> API Details (what Save sends)</span>,
                children: (
                  <div style={{ fontSize: 12 }}>
                    <div style={{ marginBottom: 6, wordBreak: 'break-all' }}>
                      <Text strong>POST</Text> <Text code>{TRAINING_ENDPOINT}</Text>
                      <Tooltip title="Copy URL">
                        <Button size="small" type="text" icon={<CopyOutlined />}
                          onClick={() => { navigator.clipboard.writeText(TRAINING_ENDPOINT); message.success('URL copied'); }} />
                      </Tooltip>
                    </div>
                    <pre style={{ background: '#2b2b2b', color: '#d4d4d4', padding: 10, borderRadius: 8, maxHeight: 220, overflow: 'auto', fontSize: 11, margin: 0 }}>
                      {JSON.stringify(buildTrainingPostBody(recipe), null, 2)}
                    </pre>
                    <Button size="small" icon={<CopyOutlined />} style={{ marginTop: 6 }}
                      onClick={() => {
                        navigator.clipboard.writeText(JSON.stringify(buildTrainingPostBody(recipe), null, 2));
                        message.success('JSON body copied');
                      }}>
                      Copy JSON body
                    </Button>
                  </div>
                ),
              }]}
            />
          </div>
        )}
      </Modal>
    </>
  );
};

export default TeachAIButton;
