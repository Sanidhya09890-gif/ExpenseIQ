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

const groupForm =
    document.getElementById('groupForm');

const welcomeText =
    document.getElementById('welcomeText');

const groupNameInput =
    document.getElementById('groupName');


// ===============================
// WELCOME MESSAGE
// ===============================

if (welcomeText) {

    welcomeText.innerHTML = `
        <div style="text-align: center; padding: 10px 0;">
            <span class="welcome-label" style="
                text-transform: uppercase; 
                letter-spacing: 3px; 
                font-size: 11px; 
                color: #a78bfa; 
                font-weight: 800;
                display: inline-block;
                animation: pulse 2s infinite alternate;
            ">
                🚀 Ready to Track?
            </span>

            <h2 style="
                font-size: 2.2rem; 
                font-weight: 900; 
                line-height: 1.2;
                margin: 8px 0 12px 0;
                background: linear-gradient(135deg, #a78bfa 0%, #38bdf8 50%, #06b6d4 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                display: block;
                filter: drop-shadow(0px 2px 8px rgba(139, 92, 246, 0.3));
            ">
                Welcome, ${userName ? userName.split(' ')[0] : 'User'}!
            </h2>

            <div style="
                display: inline-flex;
                align-items: center;
                gap: 6px;
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.1);
                padding: 6px 14px;
                border-radius: 999px;
                font-size: 13px;
                color: #cbd5e1;
                cursor: pointer;
                transition: all 0.3s ease;
            " 
            onmouseover="this.style.background='rgba(56, 189, 248, 0.15)'; this.style.borderColor='#38bdf8'; this.style.transform='scale(1.05)';" 
            onmouseout="this.style.background='rgba(255, 255, 255, 0.05)'; this.style.borderColor='rgba(255, 255, 255, 0.1)'; this.style.transform='scale(1)';">
                <span>Let's smash some bills</span> 🔥
            </div>
        </div>
    `;

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


            div.innerHTML = `

                <div class="group-card-top">

                    <div class="group-icon">
                        ${icon}
                    </div>

                    <div>

                        <h3>
                            ${group.groupName}
                        </h3>

                        <p class="group-subtext">
                            Split expenses effortlessly
                        </p>

                    </div>

                </div>


                <div class="group-buttons">

                    <button
                        class="open-btn"

                        onclick="openGroup(
                            '${group._id}',
                            '${group.groupName}'
                        )"
                    >
                        Enter
                    </button>


                    <button
                        class="delete-btn"

                        onclick="deleteGroup(
                            '${group._id}'
                        )"
                    >
                        Delete
                    </button>

                </div>

            `;

            groupsContainer.appendChild(div);

        });

    } catch (error) {

        console.log(error);

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

            const groupName =
                groupNameInput.value.trim();

            // VALIDATION
            if (!groupName) {

                alert(
                    'Please enter group name'
                );

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

                console.log(data);

                // RESET FORM
                groupForm.reset();

                // REFRESH GROUPS
                fetchGroups();

            } catch (error) {

                console.log(error);

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

async function deleteGroup(groupId) {

    const confirmDelete = confirm(

        'Are you sure you want to delete this group?'

    );

    if (!confirmDelete) {

        return;

    }

    try {

        const response = await fetch(

            `https://expenseiq-backend-xkmu.onrender.com/api/groups/delete/${groupId}`,

            {
                method: 'DELETE',

                headers: {
                    authorization: token
                }
            }

        );

        const data =
            await response.json();

        console.log(data);

        fetchGroups();

    } catch (error) {

        console.log(error);

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