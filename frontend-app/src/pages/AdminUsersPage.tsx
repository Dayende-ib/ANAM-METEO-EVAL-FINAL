import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Layout } from "../components/Layout";
import { ErrorPanel, LoadingPanel } from "../components/StatusPanel";
import {
  createAuthUser,
  deleteAuthUser,
  fetchAuthMe,
  fetchAuthUsers,
  updateAuthUser,
  type AuthUserItem,
} from "../services/api";

type CreateDraft = {
  name: string;
  email: string;
  password: string;
  is_admin: boolean;
};

type EditDraft = {
  name: string;
  email: string;
  password: string;
  is_admin: boolean;
};

const EMPTY_CREATE: CreateDraft = {
  name: "",
  email: "",
  password: "",
  is_admin: false,
};

export function AdminUsersPage() {
  const [users, setUsers] = useState<AuthUserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"success" | "error" | "info">("info");
  const [draft, setDraft] = useState<CreateDraft>(EMPTY_CREATE);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const payload = await fetchAuthUsers(200, 0);
      setUsers(payload.items ?? []);
    } catch (err) {
      console.error("Failed to load users:", err);
      setError("Impossible de charger les utilisateurs.");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuthMe()
      .then((payload) => setCurrentEmail(payload.username))
      .catch(() => setCurrentEmail(null));
  }, []);

  useEffect(() => {
    loadUsers();
  }, []);

  const isSelf = (user: AuthUserItem) => currentEmail && user.email === currentEmail;

  const hasUsers = users.length > 0;

  const resetMessages = () => {
    setMessage(null);
    setMessageType("info");
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    resetMessages();
    try {
      await createAuthUser({
        name: draft.name.trim(),
        email: draft.email.trim(),
        password: draft.password,
        is_admin: draft.is_admin,
      });
      setMessageType("success");
      setMessage("Utilisateur cree.");
      setDraft(EMPTY_CREATE);
      await loadUsers();
    } catch (err) {
      console.error("Failed to create user:", err);
      setMessageType("error");
      setMessage("Echec de creation utilisateur.");
    }
  };

  const startEdit = (user: AuthUserItem) => {
    setEditingId(user.id);
    setEditDraft({
      name: user.name,
      email: user.email,
      password: "",
      is_admin: user.is_admin,
    });
    resetMessages();
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
  };

  const handleUpdate = async (user: AuthUserItem) => {
    if (!editDraft) return;
    resetMessages();
    try {
      await updateAuthUser(user.id, {
        name: editDraft.name.trim(),
        email: editDraft.email.trim(),
        password: editDraft.password ? editDraft.password : undefined,
        is_admin: editDraft.is_admin,
      });
      setMessageType("success");
      setMessage("Utilisateur mis a jour.");
      cancelEdit();
      await loadUsers();
    } catch (err) {
      console.error("Failed to update user:", err);
      setMessageType("error");
      setMessage("Echec de mise a jour.");
    }
  };

  const handleDelete = async (user: AuthUserItem) => {
    resetMessages();
    if (!window.confirm(`Supprimer ${user.email} ?`)) {
      return;
    }
    try {
      await deleteAuthUser(user.id);
      setMessageType("success");
      setMessage("Utilisateur supprime.");
      await loadUsers();
    } catch (err) {
      console.error("Failed to delete user:", err);
      setMessageType("error");
      setMessage("Echec de suppression.");
    }
  };

  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => a.email.localeCompare(b.email));
  }, [users]);

  if (loading && !hasUsers) {
    return (
      <Layout title="Utilisateurs">
        <LoadingPanel message="Chargement des utilisateurs..." />
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout title="Utilisateurs">
        <ErrorPanel message={error} onRetry={loadUsers} />
      </Layout>
    );
  }

  return (
    <Layout title="Utilisateurs">
      <div className="space-y-6">
        <div className="surface-panel p-5 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">Gestion des comptes</h2>
            <p className="text-sm text-muted">Creer, modifier et retirer les acces.</p>
          </div>

          <form onSubmit={handleCreate} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input
              value={draft.name}
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Nom"
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              required
            />
            <input
              value={draft.email}
              onChange={(event) => setDraft((prev) => ({ ...prev, email: event.target.value }))}
              placeholder="Email"
              type="email"
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              required
            />
            <input
              value={draft.password}
              onChange={(event) => setDraft((prev) => ({ ...prev, password: event.target.value }))}
              placeholder="Mot de passe"
              type="password"
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              required
            />
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={draft.is_admin}
                  onChange={(event) => setDraft((prev) => ({ ...prev, is_admin: event.target.checked }))}
                  className="size-4 rounded border border-[var(--border)]"
                />
                Admin
              </label>
              <button
                type="submit"
                className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
              >
                Ajouter
              </button>
            </div>
          </form>

          {message && (
            <div
              className={`rounded-2xl border px-4 py-3 text-sm ${
                messageType === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : messageType === "error"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-blue-200 bg-blue-50 text-blue-700"
              }`}
            >
              {message}
            </div>
          )}
        </div>

        <div className="surface-panel overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--canvas-strong)]">
            <div>
              <h3 className="text-lg font-semibold text-ink">Utilisateurs</h3>
              <p className="text-xs text-muted">{users.length} compte(s)</p>
            </div>
          </div>
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--surface)]/70 text-xs uppercase tracking-[0.2em] text-muted sticky top-0">
                <tr>
                  <th className="px-4 py-3">Nom</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Cree</th>
                  <th className="px-4 py-3">Mis a jour</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {sortedUsers.length === 0 && (
                  <tr>
                    <td className="px-6 py-6 text-sm text-muted" colSpan={6}>
                      Aucun utilisateur.
                    </td>
                  </tr>
                )}
                {sortedUsers.map((user) => {
                  const editing = editingId === user.id;
                  const draftValues = editDraft ?? {
                    name: user.name,
                    email: user.email,
                    password: "",
                    is_admin: user.is_admin,
                  };
                  const isSelfUser = Boolean(isSelf(user));
                  return (
                    <tr key={user.id} className="hover:bg-[var(--canvas-strong)]">
                      <td className="px-4 py-3">
                        {editing ? (
                          <input
                            value={draftValues.name}
                            onChange={(event) =>
                              setEditDraft((prev) =>
                                prev ? { ...prev, name: event.target.value } : prev,
                              )
                            }
                            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
                          />
                        ) : (
                          <span className="font-semibold text-ink">{user.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {editing ? (
                          <input
                            value={draftValues.email}
                            onChange={(event) =>
                              setEditDraft((prev) =>
                                prev ? { ...prev, email: event.target.value } : prev,
                              )
                            }
                            disabled={isSelfUser}
                            className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
                          />
                        ) : (
                          <span className="text-xs text-muted">{user.email}</span>
                        )}
                        {editing && isSelfUser && (
                          <p className="mt-1 text-[11px] text-muted">
                            Email non modifiable sur votre compte.
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {editing ? (
                          <label className="flex items-center gap-2 text-xs text-ink">
                            <input
                              type="checkbox"
                              checked={draftValues.is_admin}
                              onChange={(event) =>
                                setEditDraft((prev) =>
                                  prev ? { ...prev, is_admin: event.target.checked } : prev,
                                )
                              }
                              disabled={isSelfUser}
                              className="size-4 rounded border border-[var(--border)]"
                            />
                            Admin
                          </label>
                        ) : user.is_admin ? (
                          <span className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                            Admin
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                            Standard
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">
                        {user.created_at ? new Date(user.created_at).toLocaleString("fr-FR") : "--"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">
                        {user.updated_at ? new Date(user.updated_at).toLocaleString("fr-FR") : "--"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {editing ? (
                          <div className="flex justify-end gap-2">
                            <input
                              value={draftValues.password}
                              onChange={(event) =>
                                setEditDraft((prev) =>
                                  prev ? { ...prev, password: event.target.value } : prev,
                                )
                              }
                              placeholder="Nouveau mot de passe"
                              type="password"
                              className="w-40 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => handleUpdate(user)}
                              className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white"
                            >
                              Sauver
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-muted"
                            >
                              Annuler
                            </button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => startEdit(user)}
                              className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-ink hover:bg-[var(--canvas-strong)]"
                            >
                              Modifier
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(user)}
                              disabled={isSelfUser}
                              className="rounded-full border border-red-200 px-3 py-1 text-xs text-red-700 disabled:opacity-50"
                            >
                              Supprimer
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}
