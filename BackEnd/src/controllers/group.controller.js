const Group = require('../models/group.model');
const Expense = require('../models/expense.model');


// CREATE GROUP
exports.createGroup = async (req, res) => {

    try {

        const { groupName, members } = req.body;

        const group = await Group.create({

            groupName,

            members,

            createdBy: req.user.id

        });

        res.status(201).json({
            message: "Group created successfully",
            group
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

};


// GET ALL GROUPS OF LOGGED-IN USER
exports.getGroups = async (req, res) => {

    try {

        const groups = await Group.find({
            createdBy: req.user.id
        }).populate('members', 'name email');

        res.status(200).json({
            groups
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

};

// DELETE GROUP
exports.deleteGroup = async (req, res) => {

    try {

        const { groupId } = req.params;

        // CHECK IF GROUP EXISTS AND BELONGS TO THE LOGGED-IN USER
        const group = await Group.findOne({
            _id: groupId,
            createdBy: req.user.id
        });

        if (!group) {

            return res.status(404).json({
                message: "Group not found or you are not authorized to delete it"
            });

        }

        // DELETE ALL EXPENSES OF THIS GROUP
        await Expense.deleteMany({
            groupId: groupId
        });

        // DELETE GROUP
        await Group.findByIdAndDelete(groupId);

        res.status(200).json({
            message: "Group and all expenses deleted successfully"
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

};