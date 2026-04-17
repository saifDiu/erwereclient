/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { Thread } from "@mail/core/common/thread";
import { useService } from "@web/core/utils/hooks";
import { useState, onWillStart, onWillUpdateProps, useEffect, onMounted, markup } from "@odoo/owl";
import { rpc } from "@web/core/network/rpc";
import { session } from "@web/session";
import { EmojiPicker } from "@web/core/emoji_picker/emoji_picker";
import { parseEmail } from "@mail/utils/common/format";

/**
 * Modern Chatter — patches mail.Thread to replace the message list
 * with a clean, searchable UI.
 */

patch(Thread.prototype, {

    setup() {
        super.setup(...arguments);

        this.orm = useService("orm");
        this.popover = useService("popover");
        this.notification = useService("notification");
        this.actionService = useService("action");
        this._scMyPartnerId = session?.partner_id ?? null;
        if (!this._scMyPartnerId && session?.uid) {
            this.orm.read("res.users", [session.uid], ["partner_id"]).then(([u]) => {
                if (u?.partner_id?.[0]) this._scMyPartnerId = u.partner_id[0];
            }).catch(() => {});
        }

        this.sc = useState({
            searchQuery: "",

            messages: [],
            reactions: {},
            loading: false,

            msgUi: {},
            logGroupOpen: {},
            chips: {},
        });

        onWillStart(() => this._scLoad());
        onWillUpdateProps(() => this._scLoad());

        let _scPrevMsgCount = null;
        useEffect(
            () => {
                const count = this.props.thread?.messages?.length ?? null;
                if (_scPrevMsgCount !== null && count !== _scPrevMsgCount) {
                    this._scLoad();
                }
                _scPrevMsgCount = count;
            },
            () => [this.props.thread?.messages?.length]
        );

        onMounted(() => {
            const hash = window.location.hash;
            if (hash && hash.startsWith('#sc-msg-')) {
                const id = hash.slice(8);
                setTimeout(() => this.scScrollToMsg(id), 800);
            }
        });
    },

    // ── Load ───────────────────────────────────────────────

    async _scLoad() {
        if (!this.scActive) return;
        const thread = this.props.thread;
        const resModel = thread.model;
        const resId = thread.id;

        if (!this._scMyPartnerId) {
            try {
                const uid = session?.uid;
                if (uid) {
                    const [u] = await this.orm.read("res.users", [uid], ["partner_id"]);
                    if (u?.partner_id?.[0]) this._scMyPartnerId = u.partner_id[0];
                }
            } catch (e) { /* non-fatal */ }
        }

        this.sc.loading = true;
        try {
            const msgs = await this.orm.searchRead(
                "mail.message",
                [
                    ["res_id", "=", resId],
                    ["model", "=", resModel],
                    ["message_type", "in", ["email", "comment", "notification", "auto_comment", "user_notification"]],
                ],
                [
                    "id", "date", "body", "author_id", "message_type",
                    "subtype_id", "attachment_ids", "starred_partner_ids", "subject", "email_from",
                ],
                { order: "date desc", limit: 200 }
            );

            const msgIds = msgs.map(m => m.id);

            const allAttIds = msgs.flatMap(m => m.attachment_ids || []);
            let attachMap = {};
            if (allAttIds.length) {
                const attaches = await this.orm.searchRead(
                    "ir.attachment",
                    [["id", "in", allAttIds]],
                    ["id", "name", "file_size", "mimetype"]
                );
                attachMap = Object.fromEntries(attaches.map(a => [a.id, a]));
            }

            const trackingMap = {};
            const nativeStarMap = {};
            try {
                const nativeMsgs = [...(this.props.thread.messages || [])];
                nativeMsgs.forEach(nm => {
                    if (nm.isStarred !== undefined) nativeStarMap[nm.id] = nm.isStarred;
                    if (nm.trackingValues && nm.trackingValues.length) {
                        trackingMap[nm.id] = nm.trackingValues.map(tv => ({
                            field_desc: tv.fieldInfo?.changedField || tv.changedField,
                            old_value_char: String(typeof tv.oldValue === "object" ? (tv.oldValue?.value ?? "—") : (tv.oldValue ?? "—")),
                            new_value_char: String(typeof tv.newValue === "object" ? (tv.newValue?.value ?? "—") : (tv.newValue ?? "—")),
                        }));
                    }
                });
            } catch (e) {
                console.error("[ModernChatter] native store map error", e);
            }

            const myPartnerId = this._scMyPartnerId;

            let reactionsMap = {};
            try {
                const reactionRecs = await this.orm.searchRead(
                    "mail.message.reaction",
                    [["message_id", "in", msgIds]],
                    ["message_id", "content", "partner_id"]
                );
                reactionRecs.forEach(r => {
                    const mid = r.message_id[0];
                    const emoji = r.content;
                    if (!reactionsMap[mid]) reactionsMap[mid] = {};
                    if (!reactionsMap[mid][emoji]) reactionsMap[mid][emoji] = { count: 0, myReacted: false };
                    reactionsMap[mid][emoji].count++;
                    if (myPartnerId && r.partner_id?.[0] === myPartnerId) {
                        reactionsMap[mid][emoji].myReacted = true;
                    }
                });
            } catch (e) {
                console.error("[ModernChatter] reactions load error", e);
            }

            const normalised = msgs.map(m => {
                const subtypeName = (m.subtype_id?.[1] || "").toLowerCase();
                const isLog  = m.message_type === "notification" ||
                               m.message_type === "auto_comment" ||
                               m.message_type === "user_notification";
                const isNote = !isLog && (subtypeName.includes("note") || subtypeName.includes("internal"));
                const type   = isLog ? "log" : isNote ? "note" : "email";

                let rawBody = m.body || "";
                if (!rawBody.replace(/<[^>]*>/g, "").trim()) {
                    const trackings = trackingMap[m.id] || [];
                    if (trackings.length) {
                        rawBody = trackings.map(tv =>
                            `<span class="sc-track-field">${tv.field_desc}:</span> ` +
                            `<span class="sc-track-old">${tv.old_value_char || "—"}</span>` +
                            ` → ` +
                            `<span class="sc-track-new">${tv.new_value_char || "—"}</span>`
                        ).join("<br/>");
                    }
                }

                const authorPartnerId = !isLog ? (m.author_id?.[0] || null) : null;
                return {
                    id:              m.id,
                    type,
                    author:          m.author_id?.[1] || "Unknown",
                    initials:        _initials(m.author_id?.[1] || "?"),
                    avatarColor:     _color(m.author_id?.[1] || ""),
                    avatarPartnerId: authorPartnerId,
                    isBot:           isLog || m.author_id?.[1] === "OdooBot",
                    date:            m.date,
                    dateLabel:       _fmtDate(m.date),
                    subject:         m.subject || "",
                    bodyHtml:        markup(rawBody),
                    body:            _strip(rawBody),
                    isStarred:       nativeStarMap[m.id] !== undefined
                                         ? nativeStarMap[m.id]
                                         : !!(myPartnerId && (m.starred_partner_ids || []).includes(myPartnerId)),
                    attachments:     (m.attachment_ids || []).map(id => attachMap[id]).filter(Boolean),
                    emailFrom:       m.email_from || "",
                    messageTypeRaw:  m.message_type,
                };
            });

            const msgUi = {};
            normalised.forEach(m => {
                msgUi[m.id] = { expanded: false, starred: m.isStarred, editing: false, editText: "" };
            });

            Object.assign(this.sc, {
                messages: normalised,
                msgUi,
                reactions: reactionsMap,
                loading: false,
            });

        } catch (e) {
            console.error("[ModernChatter] load error", e);
            this.sc.loading = false;
        }
    },

    // ── Active guard ───────────────────────────────────────

    get scActive() {
        const thread = this.props.thread;
        if (!thread || !thread.model || !thread.id) return false;
        return thread.model !== "discuss.channel" &&
               thread.model !== "mail.box" &&
               !thread.model.startsWith("discuss.");
    },

    // ── Derived getters ────────────────────────────────────

    get scFiltered() {
        const { messages, searchQuery } = this.sc;
        const q = searchQuery.toLowerCase();

        let result = messages.filter(m => {
            if (q && !m.body.toLowerCase().includes(q)) return false;
            return true;
        });

        return [...result].sort((a, b) => new Date(b.date) - new Date(a.date));
    },

    get scGrouped() {
        const msgs = this.scFiltered;
        const groups = [];
        let lastBucket = null;
        let i = 0;
        while (i < msgs.length) {
            const m = msgs[i];
            const bucket = _dateBucket(m.date);
            if (bucket !== lastBucket) {
                groups.push({ kind: "datesep", label: bucket });
                lastBucket = bucket;
            }
            if (m.type === "log") {
                const run = [m];
                while (i + 1 < msgs.length && msgs[i + 1].type === "log" &&
                       _dateBucket(msgs[i + 1].date) === bucket) {
                    i++;
                    run.push(msgs[i]);
                }
                if (run.length >= 3) {
                    groups.push({ kind: "loggroup", key: `lg_${run[0].id}`, items: run });
                } else {
                    run.forEach(lm => groups.push({ kind: "msg", msg: lm }));
                }
            } else {
                groups.push({ kind: "msg", msg: m });
            }
            i++;
        }
        return groups;
    },

    get scChipEntries() {
        return Object.entries(this.sc.chips);
    },

    // ── Filter actions ─────────────────────────────────────

    scSetSearch(ev) {
        this.sc.searchQuery = ev.target.value;
        this._scChip("search", ev.target.value ? `"${ev.target.value}"` : null);
    },

    scRemoveChip(key) {
        delete this.sc.chips[key];
        if (key === "search") this.sc.searchQuery = "";
    },

    _scChip(key, label) {
        if (label) this.sc.chips[key] = label;
        else delete this.sc.chips[key];
    },

    // ── Message actions ────────────────────────────────────

    async scToggleStar(id) {
        if (!Number.isInteger(id) || id <= 0) return;
        const ui = this.sc.msgUi[id];
        if (!ui) return;
        const newStarred = !ui.starred;
        try {
            await this.orm.call("mail.message", "toggle_message_starred", [[id]]);
            ui.starred = newStarred;
            const msgObj = this.sc.messages.find(m => m.id === id);
            if (msgObj) msgObj.isStarred = newStarred;
        } catch (_) {
            this.notification.add("Could not star message", { type: "danger" });
        }
    },

    scToggleExpand(id) {
        this.sc.msgUi[id].expanded = !this.sc.msgUi[id].expanded;
    },

    scStartEdit(id) {
        const msg = this.sc.messages.find(m => m.id === id);
        if (!msg || !this.sc.msgUi[id]) return;
        this.sc.msgUi[id].editing = true;
        this.sc.msgUi[id].editText = msg.body;
    },

    scEditInput(ev, id) {
        if (this.sc.msgUi[id]) this.sc.msgUi[id].editText = ev.target.value;
    },

    async scSaveEdit(id) {
        if (!Number.isInteger(id) || id <= 0) return;
        const ui = this.sc.msgUi[id];
        if (!ui) return;
        try {
            const newBody = ui.editText.replace(/\n/g, "<br/>");
            await this.orm.write("mail.message", [id], { body: newBody });
            const msg = this.sc.messages.find(m => m.id === id);
            if (msg) { msg.bodyHtml = markup(newBody); msg.body = ui.editText; }
            ui.editing = false;
            this.notification.add("Saved", { type: "success" });
        } catch (_) {
            this.notification.add("Could not save", { type: "danger" });
        }
    },

    scCancelEdit(id) {
        if (this.sc.msgUi[id]) this.sc.msgUi[id].editing = false;
    },

    async scDeleteMsg(id) {
        if (!Number.isInteger(id) || id <= 0) return;
        if (!confirm("Delete this message?")) return;
        try {
            await this.orm.unlink("mail.message", [id]);
            this.sc.messages = this.sc.messages.filter(m => m.id !== id);
            delete this.sc.msgUi[id];
            this.notification.add("Deleted", { type: "success" });
        } catch (_) {
            this.notification.add("Could not delete", { type: "danger" });
        }
    },

    async scDeleteAttachment(msgId, attId) {
        if (!Number.isInteger(attId) || attId <= 0) return;
        if (!confirm("Remove attachment?")) return;
        try {
            await this.orm.unlink("ir.attachment", [attId]);
            const msg = this.sc.messages.find(m => m.id === msgId);
            if (msg) msg.attachments = msg.attachments.filter(a => a.id !== attId);
            this.notification.add("Attachment removed", { type: "success" });
        } catch (_) {
            this.notification.add("Could not remove", { type: "danger" });
        }
    },

    scToggleLogGroup(key) {
        this.sc.logGroupOpen[key] = !this.sc.logGroupOpen[key];
    },

    scIsLong(msg) { return msg.body.length > 220; },

    scHighlight(html) {
        const raw = (html && typeof html === "object" && html.toString) ? html.toString() : (html || "");
        const q = this.sc.searchQuery;
        if (!q || !raw) return markup(raw);
        const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const result = raw.replace(new RegExp(`(${esc})`, "gi"), '<mark class="sc-hl">$1</mark>');
        return markup(result);
    },

    async scAddAttachments(ev, msgId) {
        const files = ev.target.files;
        if (!files || !files.length) return;
        const msg = this.sc.messages.find(m => m.id === msgId);
        if (!msg) return;
        for (const file of files) {
            try {
                const datas = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = e => resolve(e.target.result.split(",")[1]);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
                const [attId] = await this.orm.create("ir.attachment", [{
                    name: file.name,
                    datas,
                    res_model: "mail.message",
                    res_id: msgId,
                    mimetype: file.type || "application/octet-stream",
                }]);
                if (!msg.attachments) msg.attachments = [];
                msg.attachments.push({ id: attId, name: file.name, file_size: file.size, mimetype: file.type });
                this.notification.add(`Attached: ${file.name}`, { type: "success" });
            } catch (e) {
                console.error("[ModernChatter] attach error", e);
                this.notification.add(`Failed to upload ${file.name}`, { type: "danger" });
            }
        }
        ev.target.value = "";
    },

    scFileExt(name) {
        const ext = (name || "").split(".").pop().toUpperCase();
        return ["PDF","XLS","XLSX","DOC","DOCX","PNG","JPG","JPEG","ICS","CSV","ZIP"].includes(ext) ? ext : "FILE";
    },

    scFileSize(bytes) {
        if (!bytes) return "";
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
        return `${(bytes / 1048576).toFixed(1)} MB`;
    },

    scCopyLink(id) {
        const url = `${location.origin}${location.pathname}#sc-msg-${id}`;
        navigator.clipboard.writeText(url).then(
            () => this.notification.add("Link copied", { type: "success" }),
            () => this.notification.add("Could not copy link", { type: "danger" })
        );
    },

    // ── Reply All / Forward ────────────────────────────────

    _scFormatEmailHeader(msg) {
        const emailFrom = msg.emailFrom;
        const [name, email] = emailFrom ? parseEmail(emailFrom) : ["", ""];
        const msgDate = luxon.DateTime.fromSQL(msg.date);
        const datetime = `${msgDate.toFormat("ccc, MMM d, yyyy")} at ${msgDate.toFormat("hh:mm a")}`;
        const displayName = name || email;
        return { displayName, email, datetime };
    },

    async scReplyAll(msgId) {
        const msg = this.sc.messages.find(m => m.id === msgId);
        if (!msg) return;
        const thread = this.props.thread;
        try {
            const recipients = await rpc("/mail/thread/recipients", {
                thread_model: thread.model,
                thread_id: thread.id,
                message_id: msgId,
            });
            const recipientIds = recipients.map(r => r.id);
            const { displayName, email, datetime } = this._scFormatEmailHeader(msg);
            const msgBody = msg.bodyHtml?.toString() || "";
            const body = markup(
                `<div><br/></div>` +
                `<div class="o_mail_reply_container" data-o-mail-quote="1">` +
                `<div class="o_mail_reply_content">` +
                `<div><span>On ${datetime} ${displayName} ` +
                `<a href="mailto:${email}" target="_blank">&lt;${email}&gt;</a> wrote</span></div>` +
                `<blockquote>${msgBody}</blockquote>` +
                `</div></div>`
            );
            this.actionService.doAction({
                name: "Reply All",
                type: "ir.actions.act_window",
                res_model: "mail.compose.message",
                view_mode: "form",
                views: [[false, "form"]],
                target: "new",
                context: {
                    default_body: body,
                    default_composition_mode: "comment",
                    default_composition_comment_option: "reply_all",
                    default_email_add_signature: false,
                    default_partner_ids: recipientIds,
                    default_model: thread.model,
                    default_res_ids: [thread.id],
                    default_subject: msg.subject || "",
                    default_subtype_xmlid: "mail.mt_comment",
                },
            }, {
                onClose: () => this._scLoad(),
            });
        } catch (e) {
            console.error("[ModernChatter] reply all error", e);
            this.notification.add("Could not open reply", { type: "danger" });
        }
    },

    async scForward(msgId) {
        const msg = this.sc.messages.find(m => m.id === msgId);
        if (!msg) return;
        const thread = this.props.thread;
        try {
            const { displayName, email, datetime } = this._scFormatEmailHeader(msg);
            const msgBody = msg.bodyHtml?.toString() || "";
            const subject = msg.subject || "";
            const body = markup(
                `<div><br/></div>` +
                `<div>` +
                `<span>---------- Forwarded message ----------</span><br/>` +
                `<span>Date: ${datetime}</span><br/>` +
                `<span>From: ${displayName} <a href="mailto:${email}" target="_blank">&lt;${email}&gt;</a></span><br/>` +
                `<span>Subject: ${subject}</span>` +
                `</div>` +
                msgBody
            );
            const attachmentIds = (msg.attachments || []).map(a => a.id);
            let newAttachmentIds = [];
            if (attachmentIds.length) {
                newAttachmentIds = await this.orm.call(
                    "ir.attachment", "copy", [attachmentIds],
                    { default: { res_model: "mail.compose.message", res_id: 0 } }
                );
            }
            this.actionService.doAction({
                name: "Forward Message",
                type: "ir.actions.act_window",
                res_model: "mail.compose.message",
                view_mode: "form",
                views: [[false, "form"]],
                target: "new",
                context: {
                    default_attachment_ids: newAttachmentIds,
                    default_body: body,
                    default_composition_mode: "comment",
                    default_composition_comment_option: "forward",
                    default_email_add_signature: false,
                    default_model: thread.model,
                    default_res_ids: [thread.id],
                    default_subject: subject,
                    default_subtype_xmlid: "mail.mt_comment",
                },
            }, {
                onClose: () => this._scLoad(),
            });
        } catch (e) {
            console.error("[ModernChatter] forward error", e);
            this.notification.add("Could not open forward", { type: "danger" });
        }
    },

    scScrollToMsg(id) {
        const el = document.getElementById(`sc-msg-${id}`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('sc-link-highlight');
            setTimeout(() => el.classList.remove('sc-link-highlight'), 2500);
        }
    },

    async scToggleReaction(msgId, emoji) {
        if (!Number.isInteger(msgId) || msgId <= 0 || !emoji) return;
        const cur = this.sc.reactions[msgId]?.[emoji];
        const wasReacted = !!cur?.myReacted;
        const action = wasReacted ? "remove" : "add";
        try {
            await rpc("/mail/message/reaction", { action, content: emoji, message_id: msgId }, { silent: true });
            const prev = this.sc.reactions[msgId] || {};
            const r = prev[emoji] || { count: 0, myReacted: false };
            const updated = {
                ...prev,
                [emoji]: {
                    count: Math.max(0, wasReacted ? r.count - 1 : r.count + 1),
                    myReacted: !wasReacted,
                },
            };
            this.sc.reactions = { ...this.sc.reactions, [msgId]: updated };
        } catch (e) {
            console.error("[ModernChatter] reaction error", e);
            this.notification.add("Could not update reaction", { type: "danger" });
        }
    },

    async _scReloadReactions(msgIds) {
        try {
            const myPartnerId = this._scMyPartnerId;
            const reactionRecs = await this.orm.searchRead(
                "mail.message.reaction",
                [["message_id", "in", msgIds]],
                ["message_id", "content", "partner_id"]
            );
            const updated = { ...this.sc.reactions };
            msgIds.forEach(mid => { updated[mid] = {}; });
            reactionRecs.forEach(r => {
                const mid = r.message_id[0];
                const em = r.content;
                if (!updated[mid]) updated[mid] = {};
                if (!updated[mid][em]) updated[mid][em] = { count: 0, myReacted: false };
                updated[mid][em].count++;
                if (myPartnerId && r.partner_id?.[0] === myPartnerId) {
                    updated[mid][em].myReacted = true;
                }
            });
            this.sc.reactions = updated;
        } catch (e) {
            console.error("[ModernChatter] reaction reload error", e);
        }
    },

    scOpenPicker(msgId, ev) {
        this.popover.add(ev.target, EmojiPicker, {
            onSelect: (emoji) => this.scToggleReaction(msgId, emoji),
        });
    },
});

// ── Helpers ──────────────────────────────────────────────

function _initials(name) {
    const p = name.trim().split(/\s+/);
    return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : (p[0][0] || "?").toUpperCase();
}

const COLORS = ["#714b67","#20806a","#2d6fa8","#c8660c","#7c5cbe","#b05c5c"];
function _color(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
    return COLORS[Math.abs(h) % COLORS.length];
}

function _strip(html) {
    const d = document.createElement("div");
    d.innerHTML = html;
    return d.textContent || d.innerText || "";
}

function _fmtDate(ds) {
    if (!ds) return "";
    const d = new Date(ds), now = new Date();
    if (d.toDateString() === now.toDateString())
        return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function _dateBucket(dateStr) {
    if (!dateStr) return "Unknown";
    const d = new Date(dateStr), now = new Date();
    const diffDays = Math.floor((now - d) / 864e5);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7)  return "This week";
    if (diffDays < 30) return "This month";
    return d.toLocaleDateString([], { month: "long", year: "numeric" });
}
