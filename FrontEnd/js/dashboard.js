const token = localStorage.getItem('token');

const userName = localStorage.getItem('userName');



// ===============================
// PROTECT PAGE
// ===============================

if (!token) {

    window.location.href = './login.html';

}



// ===============================
// DOM ELEMENTS
// ===============================

const groupsContainer =
    document.getElementById('groupsContainer');
const groupCount = document.getElementById('groupCount');

const groupForm =
    document.getElementById('groupForm');

const welcomeText =
    document.getElementById('welcomeText');

const notificationBtn =
    document.getElementById('notificationBtn');

const notificationPanel =
    document.getElementById('notificationPanel');

const notificationClose =
    document.getElementById('notificationClose');

const notificationList =
    document.getElementById('notificationList');

const notificationBadge =
    document.getElementById('notificationBadge');

const groupNameInput =
    document.getElementById('groupName');



// ===============================
// NOTIFICATION PANEL
// ===============================

let notificationData = [];
let notificationFetch = null;
let expiryTimer = null;
const activityTypes = new Set(['INVITE_ACCEPTED', 'INVITE_REJECTED']);
function pendingInvitation(notification, now = Date.now()) {
    return notification.type === 'INVITE_RECEIVED' && Boolean(notification.groupId && notification.inviteId?._id) &&
        notification.inviteId.status === 'pending' && new Date(notification.inviteId.expiresAt).getTime() > now;
}
function updateNotificationBadge() {
    const count = notificationData.filter(n => pendingInvitation(n) || (activityTypes.has(n.type) && n.isRead !== true)).length;
    notificationBadge.textContent = String(count);
    notificationBadge.style.display = count ? 'flex' : 'none';
    clearTimeout(expiryTimer);
    const nextExpiry = notificationData.filter(n => pendingInvitation(n)).map(n => new Date(n.inviteId.expiresAt).getTime());
    if (nextExpiry.length) expiryTimer = setTimeout(() => {
        updateNotificationBadge();
        if (notificationPanel.classList.contains('show')) fetchNotifications();
    }, Math.min(2147483647, Math.max(1, Math.min(...nextExpiry) - Date.now())));
}
async function markDisplayedActivityRead(notifications) {
    if (!notificationPanel.classList.contains('show')) return;
    const ids = notifications.filter(n => activityTypes.has(n.type) && n.isRead !== true &&
        typeof n._id === 'string' && /^[a-fA-F0-9]{24}$/.test(n._id)).map(n => n._id);
    // Sequential bounded batches; the fetch lock covers reading and marking.
    for (let i = 0; i < ids.length; i += 100) {
        const batch = [...new Set(ids.slice(i, i + 100))];
        const response = await fetch('https://expenseiq-backend-xkmu.onrender.com/api/notifications/read', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json', authorization: token },
            body: JSON.stringify({ notificationIds: batch })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Unable to mark notifications as read.');
        for (const notification of notifications) if (batch.includes(notification._id)) notification.isRead = true;
        updateNotificationBadge();
    }
}
window.addEventListener('focus', () => fetchNotifications());

notificationBtn.addEventListener('click', () => {

    notificationPanel.classList.toggle('show');
    notificationBtn.setAttribute('aria-expanded', String(notificationPanel.classList.contains('show')));
    if (notificationPanel.classList.contains('show')) return fetchNotifications();

});

notificationClose.addEventListener('click', () => {

    notificationPanel.classList.remove('show');
    notificationBtn.setAttribute('aria-expanded', 'false');

});



// ===============================
// WELCOME MESSAGE
// ===============================

if (welcomeText) {

    const label = document.createElement('span');
    label.className = 'welcome-label';
    label.textContent = 'Ready to track';
    const heading = document.createElement('h2');
    heading.className = 'welcome-text';
    heading.textContent = "Welcome, " + (userName || 'User') + '!';
    const subtitle = document.createElement('p');
    subtitle.className = 'welcome-description';
    subtitle.textContent = 'Keep every shared expense organized, transparent, and easy to manage.';
    welcomeText.replaceChildren(label, heading, subtitle);

}



// ===============================
// FETCH GROUPS
// ===============================

const fetchGroups = async () => {

    try {

        const response = await fetch(

            'https://expenseiq-backend-xkmu.onrender.com/api/groups',

            {
                method: 'GET',

                headers: {
                    authorization: token
                }
            }

        );

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Unable to load groups.');
        groupCount.textContent = response.ok && Array.isArray(data.groups) ? String(data.groups.length) : '—';

        groupsContainer.innerHTML = '';



        // ===============================
        // NO GROUPS FOUND
        // ===============================

        if (
            !data.groups ||
            data.groups.length === 0
        ) {

            groupsContainer.innerHTML = `

                <div class="empty-groups">

                    <h3>
                        No Groups Yet
                    </h3>

                    <p>
                        Create your first group
                        and start tracking shared
                        expenses smarter.
                    </p>

                </div>

            `;

            return;

        }



        // ===============================
        // RENDER GROUPS
        // ===============================

        data.groups.forEach((group) => {

            const div =
                document.createElement('div');

            div.classList.add('group-card');



            // CATEGORY ICON
            let icon = '☰';

            if (
                group.groupName
                    .toLowerCase()
                    .includes('trip')
            ) {

                icon = '✈️';

            }

            else if (
                group.groupName
                    .toLowerCase()
                    .includes('hotel')
            ) {

                icon = '🏨';

            }

            else if (
                group.groupName
                    .toLowerCase()
                    .includes('food')
            ) {

                icon = '🍔';

            }



            const top = document.createElement('div');
            top.className = 'group-card-top';
            const badge = document.createElement('div');
            badge.className = 'group-icon';
            badge.setAttribute('aria-hidden', 'true');
            badge.textContent = icon;
            const content = document.createElement('div');
            const heading = document.createElement('h3');
            heading.textContent = group.groupName;
            const description = document.createElement('p');
            description.className = 'group-subtext';
            description.textContent = 'Shared expenses and balances';
            content.append(heading, description);
            top.append(badge, content);
            const actions = document.createElement('div');
            actions.className = 'group-buttons';
            const open = document.createElement('button');
            open.type = 'button';
            open.className = 'open-btn';
            open.textContent = 'Open Group';
            open.setAttribute('aria-label', 'Open group ' + group.groupName);
            open.addEventListener('click', () => openGroup(group._id, group.groupName));
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'delete-btn';
            remove.textContent = 'Delete';
            remove.setAttribute('aria-label', 'Delete group ' + group.groupName);
            remove.addEventListener('click', () => deleteGroup(group._id, group.groupName));
            actions.append(open, remove);
            div.append(top, actions);

            groupsContainer.appendChild(div);

        });

    } catch (error) {
        groupCount.textContent = '—';

        ExpenseUI.notify(error.message || 'Unable to load groups.', 'error');

    }

};

// ===============================
// FORMAT NOTIFICATION TIME
// ===============================

const formatNotificationTime = (createdAt) => {

    const notificationTime = new Date(createdAt);
    const currentTime = new Date();

    const differenceInSeconds =
        Math.floor(
            (currentTime - notificationTime) / 1000
        );

    if (differenceInSeconds < 60) {
        return 'Just now';
    }

    const differenceInMinutes =
        Math.floor(differenceInSeconds / 60);

    if (differenceInMinutes < 60) {
        return `${differenceInMinutes} min ago`;
    }

    const differenceInHours =
        Math.floor(differenceInMinutes / 60);

    if (differenceInHours < 24) {
        return `${differenceInHours} hr ago`;
    }

    const differenceInDays =
        Math.floor(differenceInHours / 24);

    if (differenceInDays === 1) {
        return 'Yesterday';
    }

    return notificationTime.toLocaleDateString();

};


// ===============================
// FETCH NOTIFICATIONS
// ===============================

const fetchNotifications = ({ force = false } = {}) => {
    if (notificationFetch) return force ? notificationFetch.then(() => fetchNotifications()) : notificationFetch;
    notificationFetch = loadNotifications().finally(() => { notificationFetch = null; });
    return notificationFetch;
};
const loadNotifications = async () => {

    try {

        const response = await fetch(

            'https://expenseiq-backend-xkmu.onrender.com/api/notifications',

            {
                method: 'GET',

                headers: {
                    authorization: token
                }
            }

        );

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Unable to load notifications.');

        const notifications =
            Array.isArray(data.notifications) ? data.notifications : [];
        notificationData = notifications;



        // ===============================
        // CLEAR OLD NOTIFICATIONS
        // ===============================

        notificationList.innerHTML = '';



        // ===============================
        // NOTIFICATION BADGE
        // ===============================

        updateNotificationBadge();



        // ===============================
        // NO NOTIFICATIONS
        // ===============================

        if (notifications.length === 0) {

            notificationList.innerHTML = `
                <div class="no-notifications">
                    No new notifications
                </div>
            `;

            return;

        }



        // ===============================
        // RENDER NOTIFICATIONS
        // ===============================

        notifications.forEach((notification) => {
    const groupName = notification.groupId?.groupName || 'a deleted group';
    const senderName = notification.relatedUser?.username || 'A former member';

    const notificationCard =
        document.createElement('div');

    notificationCard.classList.add('notification-card');

    if (notification.type === 'INVITE_ACCEPTED') {
        notificationCard.classList.add('notification-accepted');
    }

    if (notification.type === 'INVITE_REJECTED') {
        notificationCard.classList.add('notification-rejected');
    }

    if (notification.type === 'INVITE_RECEIVED') {
        notificationCard.classList.add('notification-invite');
    }


            let title = '🔔 Notification';
            let message = 'You have a new notification';
            let icon = '🔔';

            if (notification.type === 'INVITE_ACCEPTED') {

           title = 'Invitation Accepted';
           icon = '✓';

        message =
            `${senderName} accepted your invite to ${groupName}`;

}

if (notification.type === 'INVITE_REJECTED') {

    title = 'Invitation Rejected';
    icon = '×';

   message =
        `${senderName} rejected your invite to ${groupName}`;

}

if (notification.type === 'INVITE_RECEIVED') {

    title = 'New Group Invitation';
    icon = '✉';

    message =
        `${senderName} invited you to ${notification.groupId?.groupName ? `the group ${groupName}` : groupName}`;

}

const time =
    formatNotificationTime(notification.createdAt);

    const iconElement = document.createElement('div');
    iconElement.className = 'notification-icon';
    iconElement.setAttribute('aria-hidden', 'true');
    iconElement.textContent = icon;
    const content = document.createElement('div');
    content.className = 'notification-content';
    const heading = document.createElement('strong');
    heading.textContent = title;
    const description = document.createElement('p');
    description.textContent = message;
    const timestamp = document.createElement('span');
    timestamp.className = 'notification-time';
    timestamp.textContent = time;
    content.append(heading, description, timestamp);
    if (pendingInvitation(notification)) {
        const actions = document.createElement('div');
        actions.className = 'notification-actions';
        const accept = document.createElement('button');
        accept.type = 'button';
        accept.className = 'invite-accept-btn';
        accept.textContent = 'Accept';
        accept.addEventListener('click', () => acceptInvite(notification.inviteId._id, accept));
        const reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'invite-reject-btn';
        reject.textContent = 'Reject';
        reject.addEventListener('click', () => rejectInvite(notification.inviteId._id, reject));
        actions.append(accept, reject);
        content.appendChild(actions);
    }
    notificationCard.append(iconElement, content);

            notificationList.appendChild(
                notificationCard
            );

        });


        await markDisplayedActivityRead(notifications);

    } catch (error) {
        ExpenseUI.notify(error.message || 'Unable to load notifications.', 'error');

        console.log(
            'Error fetching notifications:',
            error
        );

    }

};



// ===============================
// CREATE GROUP
// ===============================

if (groupForm) {

    groupForm.addEventListener(

        'submit',

        async (e) => {

            e.preventDefault();

            const restore = ExpenseUI.busy(groupForm.querySelector('button[type="submit"]'), 'Creating group...');
            if (!restore) return;
            ExpenseUI.formError(groupForm);
            const groupName =
                groupNameInput.value.trim();



            // VALIDATION
            if (!groupName) {

                ExpenseUI.formError(groupForm, 'Please enter group name');
                restore();

                return;

            }



            try {

                const response = await fetch(

                    'https://expenseiq-backend-xkmu.onrender.com/api/groups/create',

                    {
                        method: 'POST',

                        headers: {

                            'Content-Type':
                                'application/json',

                            authorization:
                                token

                        },

                        body: JSON.stringify({

                            groupName,

                            members: []

                        })

                    }

                );

                const data =
                    await response.json();

                if (!response.ok) throw new Error(data.message || 'Unable to create group.');
                ExpenseUI.notify('Group created.', 'success');



                // RESET FORM
                groupForm.reset();



                // REFRESH GROUPS
                await fetchGroups();

            } catch (error) {

                ExpenseUI.formError(groupForm, error.message || 'Unable to create group.');

            } finally {
                restore();
            }

        }

    );

}



// ===============================
// OPEN GROUP
// ===============================

function openGroup(
    groupId,
    groupName
) {

    // SAVE GROUP ID
    localStorage.setItem(
        'groupId',
        groupId
    );



    // SAVE GROUP NAME
    localStorage.setItem(
        'selectedGroupName',
        groupName
    );



    // REDIRECT
    window.location.href =
        './group.html';

}



// ===============================
// DELETE GROUP
// ===============================

async function deleteGroup(groupId, groupName) {
    const deleted = await ExpenseUI.confirmDelete(groupName || 'this group', async () => {
        const response = await fetch(
            `https://expenseiq-backend-xkmu.onrender.com/api/groups/delete/${groupId}`,
            { method: 'DELETE', headers: { authorization: token } }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Unable to delete group.');
    });
    if (deleted) {
        ExpenseUI.notify('Group deleted.', 'success');
        await fetchGroups();
        document.getElementById('groupName').focus();
    }
}

// ===============================
// ACCEPT INVITATION
// ===============================

const pendingInvites = new Set();
async function acceptInvite(inviteId, button) {
    if (pendingInvites.has(inviteId)) return;
    pendingInvites.add(inviteId);
    const restore = button ? ExpenseUI.busy(button, 'Accepting...') : null;

    try {

        const response = await fetch(
            `https://expenseiq-backend-xkmu.onrender.com/api/groups/invites/${inviteId}/accept`,
            {
                method: 'POST',

                headers: {
                    authorization: token
                }
            }
        );

        const data = await response.json();

        console.log(data);

        if (!response.ok) {

            ExpenseUI.notify(data.message || 'Failed to accept invitation', 'error');

            return;
        }

        notificationPanel.classList.remove('show');
    notificationBtn.setAttribute('aria-expanded', 'false');

        await fetchNotifications({ force: true });

        await fetchGroups();

    } catch (error) {

        console.log(
            'Error accepting invitation:',
            error
        );

        ExpenseUI.notify(error.message || 'Unable to update invitation.', 'error');
    } finally {
        pendingInvites.delete(inviteId);
        restore?.();
    }

}

// ===============================
// REJECT INVITATION
// ===============================

async function rejectInvite(inviteId, button) {
    if (pendingInvites.has(inviteId)) return;
    pendingInvites.add(inviteId);
    const restore = button ? ExpenseUI.busy(button, 'Rejecting...') : null;

    try {

        const response = await fetch(
            `https://expenseiq-backend-xkmu.onrender.com/api/groups/invites/${inviteId}/reject`,
            {
                method: 'POST',

                headers: {
                    authorization: token
                }
            }
        );

        const data = await response.json();

        console.log(data);

        if (!response.ok) {

            ExpenseUI.notify(data.message || 'Failed to reject invitation', 'error');

            return;
        }

        await fetchNotifications({ force: true });

    } catch (error) {

        console.log(
            'Error rejecting invitation:',
            error
        );

        ExpenseUI.notify(error.message || 'Unable to update invitation.', 'error');
    } finally {
        pendingInvites.delete(inviteId);
        restore?.();
    }

}



// ===============================
// LOGOUT
// ===============================

function logout() {

    localStorage.clear();

    window.location.href =
        './login.html';

}



// ===============================
// INITIAL FETCH
// ===============================

fetchGroups();

fetchNotifications();
