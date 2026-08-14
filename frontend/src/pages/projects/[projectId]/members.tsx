import { useState } from 'react';
import type React from 'react';
import { DeleteOutlined, EditOutlined, PlusOutlined, QuestionCircleOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useParams } from '@umijs/max';
import { apiClient } from '@/services/api';
import { errorText } from '@/utils/format';
import { EmptyState, Modal, PageHeader } from '@/components/common';
import { useAppContext } from '@/layouts/MainLayout';

type MemberRow = { id: string; name: string; email: string; role: string };

export default function MembersPage() {
  const ctx = useAppContext();
  const { projectId: pid } = useParams();
  const projectId = Number(pid) || ctx.projectId;
  const { members, isOwner, onRefresh, onToast } = ctx;

  const [open, setOpen] = useState(false);
  const [editMember, setEditMember] = useState<{ id: string; name: string; role: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const roleLabel: Record<string, string> = { owner: '项目负责人', member: '成员', observer: '观察者' };
  const roleColor: Record<string, string> = { owner: 'owner', member: 'member', observer: 'observer' };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      await apiClient.addMember(projectId, {
        user_id: String(form.get('user_id')),
        name: String(form.get('name')),
        email: String(form.get('email')),
        role: String(form.get('role')) as 'owner' | 'member' | 'observer',
      });
      await onRefresh();
      setOpen(false);
      onToast('成员已添加');
    } catch (error) {
      onToast(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const updateRole = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editMember) return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      await apiClient.updateMemberRole(projectId, editMember.id, {
        role: String(form.get('role')) as 'owner' | 'member' | 'observer',
      });
      await onRefresh();
      setEditMember(null);
      onToast('成员角色已更新');
    } catch (error) {
      onToast(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const removeMember = async (member: { id: string; name: string }) => {
    if (!window.confirm(`确定移除成员"${member.name}"吗？`)) return;
    try {
      await apiClient.removeMember(projectId, member.id);
      await onRefresh();
      onToast('成员已移除');
    } catch (error) {
      onToast(errorText(error));
    }
  };

  return <>
    <PageHeader
      eyebrow="TEAM"
      title="成员"
      copy="管理项目成员与访问角色。项目至少需要 2 名负责人。"
      actions={<button
        className="primary-btn"
        disabled={!isOwner}
        title={!isOwner ? '只有项目负责人可以添加成员' : undefined}
        onClick={() => setOpen(true)}
      ><PlusOutlined style={{ fontSize: 15 }} /> 添加成员</button>}
    />
    <section className="panel members-page">
      {members.length ? <div className="table-wrap"><table>
        <thead><tr><th>成员</th><th>用户标识</th><th>角色</th><th></th></tr></thead>
        <tbody>{members.map((member: MemberRow) => <tr key={member.id}>
          <td><div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className="avatar avatar-blue">{member.name.slice(0, 2)}</div>
            <div><b>{member.name}</b><small>{member.email}</small></div>
          </div></td>
          <td><code>{member.id}</code></td>
          <td><span className={`role-tag ${roleColor[member.role] || 'member'}`}>{roleLabel[member.role] || member.role}</span></td>
          <td><div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            {isOwner && <button className="icon-btn" title="调整角色" onClick={() => setEditMember({ id: member.id, name: member.name, role: member.role })}><EditOutlined style={{ fontSize: 14 }} /></button>}
            {isOwner && <button className="icon-btn danger" title="移除成员" onClick={() => void removeMember(member)}><DeleteOutlined style={{ fontSize: 14 }} /></button>}
          </div></td>
        </tr>)}</tbody>
      </table></div> : <EmptyState title="暂无成员" copy="项目成员信息加载后会显示在这里。" />}
      {!isOwner && <p className="permission-note"><SafetyCertificateOutlined style={{ fontSize: 14 }} /> 你是项目成员，只能查看成员列表。</p>}
    </section>
    {open && <Modal title="添加成员" close={() => setOpen(false)}>
      <form className="form-stack" onSubmit={submit}>
        <label>用户标识<input name="user_id" required placeholder="user-123" /></label>
        <label>姓名<input name="name" required placeholder="张三" /></label>
        <label>邮箱<input name="email" type="email" required placeholder="zhangsan@example.com" /></label>
        <label>角色<select name="role" defaultValue="member">
          <option value="owner">项目负责人 (Owner)</option>
          <option value="member">成员 (Member)</option>
          <option value="observer">观察者 (Observer)</option>
        </select></label>
        <button className="primary-btn full" disabled={saving}>{saving ? '添加中…' : '添加成员'}</button>
      </form>
    </Modal>}
    {editMember && <Modal title={`调整"${editMember.name}"的角色`} close={() => setEditMember(null)}>
      <form className="form-stack" onSubmit={updateRole}>
        <label>角色<select name="role" defaultValue={editMember.role}>
          <option value="owner">项目负责人 (Owner)</option>
          <option value="member">成员 (Member)</option>
          <option value="observer">观察者 (Observer)</option>
        </select></label>
        <p className="permission-note"><QuestionCircleOutlined style={{ fontSize: 14 }} /> 项目负责人可以管理成员和修改设置，成员可以管理任务和迭代，观察者只能查看。</p>
        <button className="primary-btn full" disabled={saving}>{saving ? '保存中…' : '保存角色'}</button>
      </form>
    </Modal>}
  </>;
}
