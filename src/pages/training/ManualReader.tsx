// Training — read one manual chapter: contents on the left, topics with "Open screen" and "Mark as read",
// a learning-path stepper when opened from a path, and previous / next chapter.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Breadcrumb, Button, Card, Empty, Progress, Tag, Tooltip, Typography } from 'antd';
import {
  HomeOutlined, AimOutlined, CheckCircleFilled, CheckOutlined, LeftOutlined, RightOutlined, ClockCircleOutlined,
  PictureOutlined, ReadOutlined, ArrowRightOutlined, CloseOutlined, CompassOutlined,
} from '@ant-design/icons';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CHAPTERS, chapterById, manualLink, pathById, sectionById } from './manualCatalog';
import ManualMarkdown, { MANUAL_CSS, highlightRegExp } from './ManualMarkdown';
import { useTrainingProgress } from './trainingProgress';

const { Title, Text } = Typography;
const RED = '#C74634';

const ManualReader: React.FC = () => {
  const { chapterId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const chapter = chapterById(chapterId);
  const slug = params.get('s') || undefined;
  const path = pathById(params.get('path'));
  const hl = useMemo(() => highlightRegExp(params.get('q')), [params]);
  const { setDone, setLast, isDone, chapterDone } = useTrainingProgress();
  const [active, setActive] = useState<string | undefined>(slug);
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  const readable = CHAPTERS.filter(c => c.sections.length || c.id === 'about');
  const idx = readable.findIndex(c => c.id === chapter?.id);
  const prev = idx > 0 ? readable[idx - 1] : undefined;
  const next = idx >= 0 && idx < readable.length - 1 ? readable[idx + 1] : undefined;

  // open at the requested topic
  useEffect(() => {
    if (!chapter) return;
    const el = slug ? refs.current[slug] : null;
    const t = setTimeout(() => (el ? el.scrollIntoView({ behavior: 'smooth', block: 'start' }) : window.scrollTo({ top: 0 })), 60);
    setActive(slug);
    setLast(chapter.id, slug);
    return () => clearTimeout(t);
  }, [chapter?.id, slug]); // eslint-disable-line react-hooks/exhaustive-deps

  // highlight the topic being read in the contents, and remember it
  useEffect(() => {
    if (!chapter) return;
    const obs = new IntersectionObserver(entries => {
      const top = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      const s = top?.target.getAttribute('data-slug');
      if (s) { setActive(s); setLast(chapter.id, s); }
    }, { rootMargin: '-80px 0px -60% 0px' });
    Object.values(refs.current).forEach(el => el && obs.observe(el));
    return () => obs.disconnect();
  }, [chapter?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!chapter) {
    return (
      <div style={{ padding: 40 }}>
        <Empty description="This manual does not exist.">
          <Button onClick={() => navigate('/training')}>Back to Training</Button>
        </Empty>
      </div>
    );
  }

  const done = chapterDone(chapter);
  const total = chapter.sections.length;
  const goTo = (s: string) => refs.current[s]?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // learning path position
  const pathPos = !path ? -1 : [slug, active].map(x => path.steps.indexOf(`${chapter.id}/${x}`)).find(i => i >= 0) ?? -1;
  const pathStep = (i: number) => {
    const s = sectionById(path!.steps[i])!;
    navigate(manualLink(s.chapterId, s.slug, path!.id));
  };

  return (
    <div style={{ padding: 20, paddingRight: 96 }}>
      <style>{MANUAL_CSS}{`
        .rr-toc-item { display: flex; gap: 8px; align-items: center; padding: 5px 8px; border-radius: 6px; cursor: pointer; font-size: 13px; color: #595959; }
        .rr-toc-item:hover { background: #F5F5F5; color: #262626; }
        .rr-toc-item.active { background: ${chapter.color}12; color: ${chapter.color}; font-weight: 600; }
        .rr-topic { scroll-margin-top: ${path ? 76 : 16}px; background: #fff; border: 1px solid #F0F0F0; border-radius: 12px; padding: 18px 22px 14px; margin-bottom: 16px; }
        .rr-topic.done { border-color: #B7EB8F; }
      `}</style>

      <Breadcrumb style={{ marginBottom: 8 }} items={[
        { title: <Link to="/home"><HomeOutlined /> Home</Link> },
        { title: <Link to="/training">Training</Link> },
        { title: chapter.title },
      ]} />

      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, background: `${chapter.color}15`, color: chapter.color, display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{chapter.icon}</div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <Title level={3} style={{ margin: 0 }}>{chapter.title}</Title>
          <Text type="secondary">{chapter.summary}</Text>
          <div style={{ display: 'flex', gap: 14, fontSize: 12, color: '#8c8c8c', marginTop: 2 }}>
            {total > 0 && <span><CompassOutlined /> {total} topics</span>}
            {chapter.images > 0 && <span><PictureOutlined /> {chapter.images} screenshots</span>}
            <span><ClockCircleOutlined /> ~{chapter.minutes} min read</span>
          </div>
        </div>
        {total > 0 && (
          <div style={{ width: 180 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>{done} of {total} topics read</Text>
            <Progress percent={Math.round((done / total) * 100)} size="small" strokeColor={chapter.color} showInfo={false} />
          </div>
        )}
        {chapter.route && <Button icon={<AimOutlined />} onClick={() => navigate(chapter.route!)}>Open {chapter.title}</Button>}
      </div>

      {/* learning path bar */}
      {path && (
        <Card style={{ borderRadius: 12, marginBottom: 14, borderColor: `${path.color}55`, background: '#fff', position: 'sticky', top: 8, zIndex: 5,
          boxShadow: '0 4px 14px rgba(0,0,0,0.06)' }} styles={{ body: { padding: '10px 14px', background: `${path.color}0A`, borderRadius: 12 } }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ color: path.color, fontSize: 16 }}>{path.icon}</span>
            <Text>Learning path <Text strong>{path.title}</Text>{pathPos >= 0 ? ` — step ${pathPos + 1} of ${path.steps.length}` : ''}</Text>
            <div style={{ display: 'flex', gap: 3 }}>
              {path.steps.map((id, i) => (
                <Tooltip key={id} title={sectionById(id)?.title}>
                  <span onClick={() => pathStep(i)} style={{ width: 18, height: 6, borderRadius: 3, cursor: 'pointer',
                    background: i === pathPos ? path.color : isDone(id) ? '#95DE64' : '#E8E8E8' }} />
                </Tooltip>
              ))}
            </div>
            <span style={{ flex: 1 }} />
            <Button size="small" icon={<LeftOutlined />} disabled={pathPos <= 0} onClick={() => pathStep(pathPos - 1)}>Previous step</Button>
            <Button size="small" type="primary" style={{ background: path.color }} disabled={pathPos < 0 || pathPos >= path.steps.length - 1}
              onClick={() => { if (pathPos >= 0) setDone(path.steps[pathPos], true); pathStep(pathPos + 1); }}>
              Next step <RightOutlined />
            </Button>
            <Tooltip title="Leave the learning path"><Button size="small" type="text" icon={<CloseOutlined />}
              onClick={() => navigate(manualLink(chapter.id, active))} /></Tooltip>
          </div>
        </Card>
      )}

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        {/* contents */}
        {total > 0 && (
          <div style={{ width: 240, flex: 'none', position: 'sticky', top: path ? 76 : 12 }}>
            <Card size="small" title={<span><ReadOutlined /> Contents</span>} style={{ borderRadius: 12 }} styles={{ body: { padding: 6 } }}>
              {chapter.sections.map(s => (
                <div key={s.id} className={`rr-toc-item${active === s.slug ? ' active' : ''}`} onClick={() => goTo(s.slug)}>
                  {isDone(s.id) ? <CheckCircleFilled style={{ color: '#52c41a' }} /> : <span style={{ width: 14 }} />}
                  <span>{s.title}</span>
                </div>
              ))}
            </Card>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
              {prev && <Button block icon={<LeftOutlined />} onClick={() => navigate(manualLink(prev.id))} style={{ textAlign: 'left' }}>{prev.title}</Button>}
              {next && <Button block onClick={() => navigate(manualLink(next.id))} style={{ textAlign: 'left' }}>{next.title} <RightOutlined /></Button>}
            </div>
          </div>
        )}

        {/* topics */}
        <div style={{ flex: 1, minWidth: 0, maxWidth: 980 }}>
          {chapter.intro && (
            <div className="rr-topic">
              <ManualMarkdown md={chapter.intro} highlight={hl} />
            </div>
          )}
          {chapter.sections.map((s, i) => {
            const read = isDone(s.id);
            return (
              <div key={s.id} ref={el => { refs.current[s.slug] = el; }} data-slug={s.slug} className={`rr-topic${read ? ' done' : ''}`}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                  <Title level={4} style={{ margin: 0 }}>{s.title}</Title>
                  {read && <Tag color="success" icon={<CheckOutlined />}>Read</Tag>}
                  <Text type="secondary" style={{ fontSize: 12 }}><ClockCircleOutlined /> {s.minutes} min</Text>
                  <span style={{ flex: 1 }} />
                  {s.route && (
                    <Tooltip title={`Go to ${s.route} — the screen this topic explains`}>
                      <Button size="small" icon={<AimOutlined />} onClick={() => navigate(s.route!)}>Open screen</Button>
                    </Tooltip>
                  )}
                </div>
                <ManualMarkdown md={s.body} highlight={hl} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid #F5F5F5', paddingTop: 10, marginTop: 6 }}>
                  <Button size="small" type={read ? 'default' : 'primary'} style={read ? undefined : { background: '#1D7B4D' }}
                    icon={read ? <CheckCircleFilled style={{ color: '#52c41a' }} /> : <CheckOutlined />}
                    onClick={() => setDone(s.id, !read)}>
                    {read ? 'Read — mark as unread' : 'Mark as read'}
                  </Button>
                  <span style={{ flex: 1 }} />
                  {path && path.steps.indexOf(s.id) >= 0 && path.steps.indexOf(s.id) < path.steps.length - 1 ? (
                    <Button size="small" type="primary" style={{ background: path.color }}
                      onClick={() => { if (!read) setDone(s.id, true); pathStep(path.steps.indexOf(s.id) + 1); }}>
                      Next step: {sectionById(path.steps[path.steps.indexOf(s.id) + 1])?.title} <ArrowRightOutlined />
                    </Button>
                  ) : i < total - 1 ? (
                    <Button size="small" type="link" onClick={() => { if (!read) setDone(s.id, true); goTo(chapter.sections[i + 1].slug); }}>
                      Next: {chapter.sections[i + 1].title} <ArrowRightOutlined />
                    </Button>
                  ) : next && (
                    <Button size="small" type="link" onClick={() => { if (!read) setDone(s.id, true); navigate(manualLink(next.id)); }}>
                      Next manual: {next.title} <ArrowRightOutlined />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {total === 0 && next && (
            <Button type="primary" style={{ background: RED }} onClick={() => navigate(manualLink(next.id))}>Start with {next.title} <ArrowRightOutlined /></Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ManualReader;
