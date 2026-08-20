import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Lightbulb,
  RefreshCw,
  Send,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { apiClient } from '../api';
import { useProjectMeta } from '../context';
import { errorText } from '../lib/format';
import { PageHeader } from '../components/shared/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/shared/States';
import { Modal } from '../components/shared/Modal';
import type {
  CopilotChanges,
  CopilotChatTurn,
  CopilotItem,
  CopilotRange,
  CopilotStageAnalysis,
  CopilotSummary,
} from '../types';

type CopilotTab = 'summary' | 'chat' | 'changes';

const itemKindLabel: Record<CopilotItem['kind'], string> = {
  fact: '事实',
  inference: '推断',
  suggestion: '建议',
};
const itemKindTone: Record<CopilotItem['kind'], string> = {
  fact: 'fact',
  inference: 'inference',
  suggestion: 'suggestion',
};

function ItemList({ items, projectId }: { items: CopilotItem[]; projectId: number }) {
  const navigate = useNavigate();
  if (!items.length) return null;
  return (
    <ul className="copilot-item-list">
      {items.map((item, index) => (
        <li key={`${item.kind}-${index}`} className="copilot-item">
          <span className={`copilot-kind ${itemKindTone[item.kind]}`}>
            {itemKindLabel[item.kind]}
          </span>
          <span className="copilot-item-text">{item.text}</span>
          {item.link_path && (
            <button
              className="link copilot-item-link"
              onClick={() => navigate(item.link_path!)}
            >
              {item.link_label || '查看对象'} →
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** AI 副驾驶页（PRD-07）：项目摘要 / 问答 / 近期变化。 */
export function CopilotView() {
  const { projectId } = useProjectMeta();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as CopilotTab | null) || 'summary';
  const [tab, setTab] = useState<CopilotTab>(initialTab === 'chat' ? 'chat' : initialTab === 'changes' ? 'changes' : 'summary');
  const [summary, setSummary] = useState<CopilotSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [messages, setMessages] = useState<CopilotChatTurn[]>([]);
  const [question, setQuestion] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [range, setRange] = useState<CopilotRange>('7d');
  const [changes, setChanges] = useState<CopilotChanges | null>(null);
  const [changesLoading, setChangesLoading] = useState(false);
  const [changesError, setChangesError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      setSummary(await apiClient.copilotSummary(projectId));
    } catch (err) {
      setSummaryError(errorText(err));
    } finally {
      setSummaryLoading(false);
    }
  }, [projectId]);

  const loadChanges = useCallback(async () => {
    setChangesLoading(true);
    setChangesError(null);
    try {
      setChanges(await apiClient.copilotChanges(projectId, range));
    } catch (err) {
      setChangesError(errorText(err));
    } finally {
      setChangesLoading(false);
    }
  }, [projectId, range]);

  useEffect(() => {
    if (tab === 'summary' && !summary) void loadSummary();
  }, [tab, summary, loadSummary]);
  useEffect(() => {
    if (tab === 'changes') void loadChanges();
  }, [tab, range, loadChanges]);

  const switchTab = (next: CopilotTab) => {
    setTab(next);
    if (next === 'summary') searchParams.delete('tab');
    else searchParams.set('tab', next);
    setSearchParams(searchParams, { replace: true });
  };

  const sendChat = async () => {
    const text = question.trim();
    if (!text || chatSending) return;
    const history = messages;
    setMessages((list) => [...list, { role: 'user', content: text, links: null }]);
    setQuestion('');
    setChatSending(true);
    try {
      const answer = await apiClient.copilotChat(projectId, text, history);
      setMessages((list) => [...list, answer]);
    } catch (err) {
      setMessages((list) => [
        ...list,
        { role: 'assistant', content: errorText(err), links: null },
      ]);
    } finally {
      setChatSending(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="AI COPILOT"
        title="AI 副驾驶"
        copy="基于实时项目数据生成摘要、风险分析与行动建议，不自动修改任何数据。"
      />
      <div className="workbench-tabs" role="tablist">
        <button className={tab === 'summary' ? 'active' : ''} onClick={() => switchTab('summary')}>
          项目摘要
        </button>
        <button className={tab === 'chat' ? 'active' : ''} onClick={() => switchTab('chat')}>
          项目管理问答
        </button>
        <button className={tab === 'changes' ? 'active' : ''} onClick={() => switchTab('changes')}>
          近期变化回顾
        </button>
      </div>

      {tab === 'summary' && (
        <section className="panel stage-workbench copilot-summary">
          <div className="panel-head">
            <div>
              <h2>项目状态摘要</h2>
              <p>主阶段优先，风险与建议均提供项目记录入口。</p>
            </div>
            <button
              className="ghost-btn"
              disabled={summaryLoading}
              onClick={() => void loadSummary()}
            >
              <RefreshCw size={15} className={summaryLoading ? 'spin' : ''} /> 重新生成
            </button>
          </div>
          {summaryError ? (
            <ErrorState message={summaryError} retry={() => void loadSummary()} />
          ) : summaryLoading ? (
            <LoadingState />
          ) : !summary ? (
            <EmptyState title="暂无摘要" copy="点击「重新生成」获取项目摘要。" />
          ) : (
            <div className="copilot-section-stack">
              {summary.insufficient_data ? (
                <EmptyState
                  title="项目尚未启动，数据不足"
                  copy="启动阶段并创建任务后，副驾驶即可生成摘要。"
                />
              ) : (
                <>
                  <div className="copilot-block">
                    <h3>主阶段</h3>
                    {summary.primary_stage ? (
                      <p className="copilot-primary">
                        <b>{summary.primary_stage.name}</b>
                        <span className={`copilot-stage-status ${summary.primary_stage.status}`}>
                          {summary.primary_stage.status === 'active'
                            ? '进行中'
                            : summary.primary_stage.status === 'blocked'
                              ? '受阻'
                              : summary.primary_stage.status === 'pending_acceptance'
                                ? '待验收'
                                : summary.primary_stage.status === 'completed'
                                  ? '已完成'
                                  : '未开始'}
                        </span>
                        <small>负责人：{summary.primary_stage.owner_name || '未指定'}</small>
                      </p>
                    ) : (
                      <p className="permission-note">项目暂无主阶段。</p>
                    )}
                  </div>
                  {summary.parallel_stages.length > 0 && (
                    <div className="copilot-block">
                      <h3>并行阶段</h3>
                      {summary.parallel_stages.map((stage, index) => (
                        <p key={`${stage.name}-${index}`} className="copilot-parallel">
                          <b>{stage.name}</b>
                          <small>负责人：{stage.owner_name || '未指定'}</small>
                        </p>
                      ))}
                    </div>
                  )}
                  <div className="copilot-block">
                    <h3>风险清单</h3>
                    {summary.risks.length ? (
                      <ItemList items={summary.risks} projectId={projectId} />
                    ) : (
                      <p className="permission-note">当前未发现项目记录支持的风险。</p>
                    )}
                  </div>
                  <div className="copilot-block">
                    <h3>建议行动</h3>
                    {summary.actions.length ? (
                      <ol className="copilot-actions">
                        {summary.actions.map((action) => (
                          <li key={action.order}>
                            <b>{action.text}</b>
                            <small>{action.reason}</small>
                            {action.link_path && (
                              <button
                                className="link"
                                onClick={() => navigate(action.link_path!)}
                              >
                                查看对象 →
                              </button>
                            )}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="permission-note">暂无需要优先处理的事项。</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      )}

      {tab === 'chat' && (
        <section className="panel stage-workbench copilot-chat">
          <div className="chat-scroll">
            {messages.length ? (
              messages.map((message, index) => (
                <div className={`chat-turn ${message.role}`} key={index}>
                  <div className="chat-avatar">
                    {message.role === 'user' ? '我' : <Bot size={15} />}
                  </div>
                  <div className="chat-bubble">
                    <p>{message.content}</p>
                    {message.links && message.links.length > 0 && (
                      <div className="chat-links">
                        {message.links.map((link, linkIndex) => (
                          <button
                            className="link"
                            key={`${link.label}-${linkIndex}`}
                            onClick={() => navigate(link.path)}
                          >
                            {link.label} →
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                title="向副驾驶提问"
                copy="可询问项目状态、阶段进展、任务依赖、阻塞与近期变化。"
              />
            )}
          </div>
          <div className="chat-input">
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void sendChat();
                }
              }}
              placeholder="输入问题，例如：项目现在是什么状态？"
              disabled={chatSending}
            />
            <button className="primary-btn" disabled={chatSending || !question.trim()} onClick={() => void sendChat()}>
              {chatSending ? '分析中…' : <Send size={15} />}
            </button>
          </div>
        </section>
      )}

      {tab === 'changes' && (
        <section className="panel stage-workbench copilot-changes">
          <div className="panel-head">
            <div>
              <h2>近期变化</h2>
              <p>按时间范围回顾阶段、任务、阻塞、交付物与验收变化。</p>
            </div>
            <div className="range-switch">
              {(['24h', '7d', '30d'] as CopilotRange[]).map((value) => (
                <button
                  key={value}
                  className={range === value ? 'active' : ''}
                  onClick={() => setRange(value)}
                >
                  {value === '24h' ? '24小时' : value === '7d' ? '7天' : '30天'}
                </button>
              ))}
            </div>
          </div>
          {changesError ? (
            <ErrorState message={changesError} retry={() => void loadChanges()} />
          ) : changesLoading ? (
            <LoadingState />
          ) : !changes ? (
            <EmptyState title="暂无数据" copy="选择时间范围查看近期变化。" />
          ) : changes.completed.length + changes.unresolved.length + changes.new_risks.length === 0 ? (
            <EmptyState title="该时间范围内无项目活动" copy="项目在此期间没有可回顾的变化。" />
          ) : (
            <div className="copilot-section-stack">
              <div className="copilot-block">
                <h3>
                  <CheckCircle2 size={14} /> 已完成（{changes.completed.length}）
                </h3>
                <ItemList items={changes.completed} projectId={projectId} />
              </div>
              <div className="copilot-block">
                <h3>
                  <Clock size={14} /> 仍未解决（{changes.unresolved.length}）
                </h3>
                <ItemList items={changes.unresolved} projectId={projectId} />
              </div>
              <div className="copilot-block">
                <h3>
                  <AlertTriangle size={14} /> 新出现风险（{changes.new_risks.length}）
                </h3>
                <ItemList items={changes.new_risks} projectId={projectId} />
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}

/** 阶段工作台入口：当前阶段风险分析弹窗（事实/推断/建议，信息不足标注）。 */
export function StageRiskAnalysisModal({
  projectId,
  stageId,
  onClose,
}: {
  projectId: number;
  stageId: number;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [data, setData] = useState<CopilotStageAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiClient
      .copilotStageAnalysis(projectId, stageId)
      .then(setData)
      .catch((err) => setError(errorText(err)))
      .finally(() => setLoading(false));
  }, [projectId, stageId]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Modal title="当前阶段风险分析" close={onClose}>
      <div className="form-stack">
        <p className="permission-note">
          <Sparkles size={14} /> 基于实时阶段数据生成，区分事实、推断与建议；信息不足处会明确标注。
        </p>
        {error ? (
          <ErrorState message={error} retry={load} />
        ) : loading ? (
          <LoadingState />
        ) : !data ? (
          <EmptyState title="暂无分析" copy="请重试。" />
        ) : data.has_risk ? (
          <ul className="copilot-item-list">
            {data.items.map((item, index) => (
              <li key={`${item.kind}-${index}`} className="copilot-item">
                <span className={`copilot-kind ${itemKindTone[item.kind]}`}>
                  {itemKindLabel[item.kind]}
                </span>
                <span className="copilot-item-text">{item.text}</span>
                {item.link_path && (
                  <button className="link copilot-item-link" onClick={() => navigate(item.link_path!)}>
                    {item.link_label || '查看对象'} →
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="permission-note">
            <CheckCircle2 size={14} /> 当前未发现该阶段的风险。
          </p>
        )}
      </div>
    </Modal>
  );
}
