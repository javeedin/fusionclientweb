// Training — module home: search every manual, help for the screen you came from, learning paths by role,
// the manual chapters with your reading progress, and the video library.
import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Breadcrumb, Button, Card, Col, Empty, Input, Progress, Row, Tag, Tooltip, Typography } from 'antd';
import {
  HomeOutlined, ReadOutlined, SearchOutlined, VideoCameraOutlined, ExportOutlined, CheckCircleFilled,
  ArrowRightOutlined, AimOutlined, HistoryOutlined, PictureOutlined, ClockCircleOutlined, CompassOutlined,
} from '@ant-design/icons';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  CHAPTERS, ALL_SECTIONS, LEARNING_PATHS, TOTAL_IMAGES, ONLINE_EDITION_URL, chapterById, sectionById,
  helpForScreen, manualLink, searchManual, LearningPath,
} from './manualCatalog';
import { renderInline, highlightRegExp, MANUAL_CSS } from './ManualMarkdown';
import { useTrainingProgress } from './trainingProgress';
import { ALL_MENU_ITEMS } from '../../data/menuItems';

const { Title, Text } = Typography;
const RED = '#C74634';

const screenName = (path: string) => {
  const clean = path.split('?')[0];
  return ALL_MENU_ITEMS.filter(m => clean === m.path || clean.startsWith(`${m.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]?.label;
};

const TrainingHome: React.FC = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') || '');
  const deferred = useDeferredValue(query);
  const searchRef = useRef<any>(null);
  const { progress, chapterDone, pathDone, isDone } = useTrainingProgress();

  const from = params.get('from');
  const help = useMemo(() => helpForScreen(from), [from]);
  const hits = useMemo(() => searchManual(deferred), [deferred]);
  const hl = useMemo(() => highlightRegExp(deferred), [deferred]);
  const chapters = CHAPTERS.filter(c => c.sections.length);
  const totalDone = ALL_SECTIONS.filter(s => isDone(s.id)).length;
  const last = progress.last && chapterById(progress.last.chapterId);
  const lastSection = progress.last?.slug ? sectionById(`${progress.last.chapterId}/${progress.last.slug}`) : undefined;

  // "/" focuses the search box (unless the user is typing somewhere)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(t?.tagName) && !t?.isContentEditable) {
        e.preventDefault(); searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // keep the search in the URL so Back returns to the results
  useEffect(() => {
    const p = new URLSearchParams(params);
    if (deferred.trim()) p.set('q', deferred.trim()); else p.delete('q');
    if (p.toString() !== params.toString()) setParams(p, { replace: true });
  }, [deferred]); // eslint-disable-line react-hooks/exhaustive-deps

  const startPath = (p: LearningPath) => {
    const next = p.steps.find(id => !isDone(id)) ?? p.steps[0];
    const s = sectionById(next)!;
    navigate(manualLink(s.chapterId, s.slug, p.id));
  };

  return (
    <div style={{ padding: 20, paddingRight: 96 }}>
      <style>{MANUAL_CSS}{`
        .rr-train-card { border-radius: 12px; height: 100%; transition: box-shadow .2s, transform .2s; }
        .rr-train-card:hover { box-shadow: 0 6px 22px rgba(0,0,0,0.08); transform: translateY(-1px); }
        .rr-train-topic { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 2px 0; color: #595959; cursor: pointer; }
        .rr-train-topic:hover { color: ${RED}; }
        .rr-train-hit { padding: 12px 14px; border-radius: 10px; cursor: pointer; border: 1px solid transparent; }
        .rr-train-hit:hover { background: #FAFAFA; border-color: #F0F0F0; }
      `}</style>

      <Breadcrumb style={{ marginBottom: 8 }} items={[{ title: <Link to="/home"><HomeOutlined /> Home</Link> }, { title: 'Training' }]} />

      {/* hero */}
      <div style={{
        borderRadius: 16, padding: '22px 24px 20px', marginBottom: 16, color: '#fff',
        background: 'linear-gradient(120deg, #C74634 0%, #9E2F21 55%, #6E1F15 100%)', boxShadow: '0 8px 24px rgba(199,70,52,0.25)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(255,255,255,0.16)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 24 }}><ReadOutlined /></div>
            <div>
              <Title level={3} style={{ margin: 0, color: '#fff' }}>Training</Title>
              <Text style={{ color: 'rgba(255,255,255,0.85)' }}>User manuals for every module, learning paths by role, and screen recordings.</Text>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button ghost icon={<VideoCameraOutlined />} onClick={() => navigate('/training/videos')}>Video library</Button>
            <Tooltip title="The same manual as a shared document (opens claude.ai — needs access)">
              <Button ghost icon={<ExportOutlined />} onClick={() => window.open(ONLINE_EDITION_URL, '_blank', 'noopener')}>Online edition</Button>
            </Tooltip>
          </div>
        </div>
        <Input ref={searchRef} size="large" allowClear value={query} onChange={e => setQuery(e.target.value)}
          prefix={<SearchOutlined style={{ color: '#8c8c8c' }} />}
          placeholder='Search the manuals — e.g. "send invoice for approval", "close period", "bank reconciliation"   ( / )'
          style={{ marginTop: 18, borderRadius: 10 }} />
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12, fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>
          <span><ReadOutlined /> {chapters.length} manuals</span>
          <span><CompassOutlined /> {ALL_SECTIONS.length} topics</span>
          <span><PictureOutlined /> {TOTAL_IMAGES} screenshots</span>
          <span><CheckCircleFilled /> You have read {totalDone} of {ALL_SECTIONS.length} topics</span>
        </div>
      </div>

      {/* search results */}
      {deferred.trim() ? (
        <Card style={{ borderRadius: 12 }} title={<span><SearchOutlined /> {hits.length ? `${hits.length} topic${hits.length === 1 ? '' : 's'} found` : 'No topics found'}</span>}
          extra={<Button type="link" onClick={() => setQuery('')}>Clear search</Button>}>
          {hits.length === 0 ? (
            <Empty description={<span>Nothing matches “{deferred}”. Try fewer or different words, or browse the manuals below.</span>} />
          ) : hits.map(h => (
            <div key={h.section.id} className="rr-train-hit" onClick={() => navigate(`${manualLink(h.chapter.id, h.section.slug)}&q=${encodeURIComponent(deferred)}`)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Tag color={h.chapter.color} style={{ marginRight: 0 }}>{h.chapter.title}</Tag>
                <Text strong style={{ fontSize: 15 }}>{renderInline(h.section.title, hl, h.section.id)}</Text>
                {isDone(h.section.id) && <Tooltip title="You have read this"><CheckCircleFilled style={{ color: '#52c41a' }} /></Tooltip>}
                <span style={{ flex: 1 }} />
                {h.section.route && (
                  <Button size="small" icon={<AimOutlined />} onClick={e => { e.stopPropagation(); navigate(h.section.route!); }}>Open screen</Button>
                )}
              </div>
              <div style={{ fontSize: 13, color: '#595959', marginTop: 4 }}>{renderInline(h.snippet, hl, `${h.section.id}-s`)}</div>
            </div>
          ))}
        </Card>
      ) : (
        <>
          {/* help for the screen the user came from */}
          {help && (
            <Card style={{ borderRadius: 12, marginBottom: 16, borderColor: '#91CAFF', background: '#F0F7FF' }} styles={{ body: { padding: 16 } }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <AimOutlined style={{ fontSize: 22, color: '#0572CE', marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 260 }}>
                  <Text strong>Help for the screen you were on{screenName(from!) ? `: ${screenName(from!)}` : ''}</Text>
                  <div style={{ fontSize: 13, color: '#595959', marginBottom: 8 }}>
                    {help.sections.length ? `${help.chapter.title} manual — the topics that explain this screen:` : `This screen is part of ${help.chapter.title}.`}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {(help.sections.length ? help.sections : help.chapter.sections.slice(0, 4)).map(s => (
                      <Button key={s.id} type={help.sections[0]?.id === s.id ? 'primary' : 'default'} icon={isDone(s.id) ? <CheckCircleFilled /> : <ReadOutlined />}
                        onClick={() => navigate(manualLink(s.chapterId, s.slug))}>{s.title}</Button>
                    ))}
                    <Button type="link" onClick={() => navigate(manualLink(help.chapter.id))}>Whole {help.chapter.title} manual <ArrowRightOutlined /></Button>
                  </div>
                </div>
                <Button type="text" size="small" onClick={() => { const p = new URLSearchParams(params); p.delete('from'); setParams(p, { replace: true }); }}>Dismiss</Button>
              </div>
            </Card>
          )}

          {/* continue reading */}
          {last && (
            <Card style={{ borderRadius: 12, marginBottom: 16 }} styles={{ body: { padding: '12px 16px' } }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <HistoryOutlined style={{ fontSize: 18, color: last.color }} />
                <Text>Continue where you left off: <Text strong>{last.title}</Text>{lastSection ? <> › <Text strong>{lastSection.title}</Text></> : null}</Text>
                <span style={{ flex: 1 }} />
                <Button type="primary" style={{ background: RED }} onClick={() => navigate(manualLink(last.id, lastSection?.slug))}>Continue reading</Button>
              </div>
            </Card>
          )}

          {/* learning paths */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '4px 0 10px' }}>
            <Title level={5} style={{ margin: 0 }}>Learning paths</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>The topics one role needs, in the order to read them</Text>
          </div>
          <Row gutter={[12, 12]} style={{ marginBottom: 22 }}>
            {LEARNING_PATHS.map(p => {
              const done = pathDone(p);
              const pct = Math.round((done / p.steps.length) * 100);
              return (
                <Col key={p.id} xs={24} sm={12} xl={8} xxl={4}>
                  <Card className="rr-train-card" styles={{ body: { padding: 14, display: 'flex', flexDirection: 'column', height: '100%' } }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 9, background: `${p.color}18`, color: p.color, display: 'flex',
                        alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>{p.icon}</div>
                      <div style={{ lineHeight: 1.25 }}>
                        <div style={{ fontWeight: 600 }}>{p.title}</div>
                        <Text type="secondary" style={{ fontSize: 11 }}>{p.who}</Text>
                      </div>
                    </div>
                    <div style={{ margin: '10px 0 8px', flex: 1 }}>
                      {p.steps.slice(0, 4).map((id, i) => {
                        const s = sectionById(id)!;
                        return (
                          <div key={id} className="rr-train-topic" onClick={() => navigate(manualLink(s.chapterId, s.slug, p.id))}>
                            {isDone(id) ? <CheckCircleFilled style={{ color: '#52c41a' }} /> : <span style={{ width: 14, textAlign: 'center', fontSize: 11, color: '#bfbfbf' }}>{i + 1}</span>}
                            <span style={{ fontSize: 10, color: '#8c8c8c', background: '#F5F5F5', borderRadius: 4, padding: '0 5px', flex: 'none' }}>{chapterById(s.chapterId)?.short}</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                          </div>
                        );
                      })}
                      {p.steps.length > 4 && <Text type="secondary" style={{ fontSize: 11, paddingLeft: 20 }}>+ {p.steps.length - 4} more</Text>}
                    </div>
                    <Progress percent={pct} size="small" strokeColor={p.color} format={() => `${done}/${p.steps.length}`} />
                    <Button block style={{ marginTop: 8 }} onClick={() => startPath(p)}>
                      {done === 0 ? 'Start' : done === p.steps.length ? 'Read again' : 'Continue'} <ArrowRightOutlined />
                    </Button>
                  </Card>
                </Col>
              );
            })}
          </Row>

          {/* manuals */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '4px 0 10px' }}>
            <Title level={5} style={{ margin: 0 }}>User manuals</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>Step-by-step guides with screenshots, one per module</Text>
            <span style={{ flex: 1 }} />
            <Button type="link" size="small" onClick={() => navigate(manualLink('about'))}>About this manual</Button>
          </div>
          <Row gutter={[12, 12]} style={{ marginBottom: 22 }}>
            {chapters.map(c => {
              const done = chapterDone(c);
              return (
                <Col key={c.id} xs={24} sm={12} lg={8} xxl={6}>
                  <Card hoverable className="rr-train-card" onClick={() => navigate(manualLink(c.id))}
                    styles={{ body: { padding: 16, display: 'flex', flexDirection: 'column', height: '100%' } }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <div style={{ width: 42, height: 42, borderRadius: 10, background: `${c.color}15`, color: c.color, display: 'flex',
                        alignItems: 'center', justifyContent: 'center', fontSize: 20, flex: 'none' }}>{c.icon}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{c.title}</div>
                        <Text type="secondary" style={{ fontSize: 12 }}>{c.summary}</Text>
                      </div>
                      <Progress type="circle" size={40} percent={Math.round((done / c.sections.length) * 100)} strokeColor={c.color}
                        format={() => <span style={{ fontSize: 10 }}>{done}/{c.sections.length}</span>} />
                    </div>
                    <div style={{ margin: '10px 0 6px', flex: 1 }}>
                      {c.sections.slice(0, 5).map(s => (
                        <div key={s.id} className="rr-train-topic" onClick={e => { e.stopPropagation(); navigate(manualLink(c.id, s.slug)); }}>
                          {isDone(s.id) ? <CheckCircleFilled style={{ color: '#52c41a' }} /> : <ReadOutlined style={{ color: '#bfbfbf' }} />}
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                        </div>
                      ))}
                      {c.sections.length > 5 && <Text type="secondary" style={{ fontSize: 11, paddingLeft: 20 }}>+ {c.sections.length - 5} more topics</Text>}
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#8c8c8c' }}>
                      <span><CompassOutlined /> {c.sections.length} topics</span>
                      {c.images > 0 && <span><PictureOutlined /> {c.images} screenshots</span>}
                      <span><ClockCircleOutlined /> ~{c.minutes} min</span>
                    </div>
                  </Card>
                </Col>
              );
            })}
          </Row>

          {/* videos */}
          <Card className="rr-train-card" hoverable onClick={() => navigate('/training/videos')} styles={{ body: { padding: 16 } }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ width: 42, height: 42, borderRadius: 10, background: `${RED}15`, color: RED, display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 20 }}><VideoCameraOutlined /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>Video library</div>
                <Text type="secondary" style={{ fontSize: 12 }}>Screen recordings made with the Record Screen button in the desktop app: walkthroughs, UAT scripts and demos.</Text>
              </div>
              <ArrowRightOutlined />
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

export default TrainingHome;
