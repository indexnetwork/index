"use client";

import React, { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { User } from "@/lib/types";
import { useAuth } from "@/contexts/APIContext";

interface PreferencesModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    user: User | null;
    onUserUpdate: (user: User) => void;
}

interface DialogComponentProps extends React.HTMLAttributes<HTMLDivElement> {
    className?: string;
    children?: React.ReactNode;
}

interface DialogTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
    className?: string;
    children?: React.ReactNode;
}

// Create simple wrapper components for dialog parts
const DialogContent = ({ className, children, ...props }: DialogComponentProps) => (
    <Dialog.Portal>
        <Dialog.Content
            className={`fixed left-[50%] top-[50%] z-50 w-full max-w-lg max-h-[90vh] translate-x-[-50%] translate-y-[-50%] border bg-white shadow-lg duration-200 sm:rounded-lg flex flex-col ${className}`}
            {...props}
        >
            {children}
            <Dialog.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
            </Dialog.Close>
        </Dialog.Content>
    </Dialog.Portal>
);

const DialogHeader = ({ className, children, ...props }: DialogComponentProps) => (
    <div className={`flex flex-col space-y-1.5 text-center sm:text-left px-6 pt-6 pb-4 border-b ${className}`} {...props}>
        {children}
    </div>
);

const DialogTitle = ({ className, children, ...props }: DialogTitleProps) => (
    <Dialog.Title className={`text-lg font-semibold leading-none tracking-tight ${className}`} {...props}>
        {children}
    </Dialog.Title>
);

export default function PreferencesModal({ open, onOpenChange, user, onUserUpdate }: PreferencesModalProps) {
    const [isLoading, setIsLoading] = useState(false);
    const authService = useAuth();

    const [notificationPreferences, setNotificationPreferences] = useState(user?.notificationPreferences || {
        connectionUpdates: true,
        weeklyNewsletter: true,
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;

        setIsLoading(true);
        try {
            const updatedUser = await authService.updateProfile({
                notificationPreferences,
            });

            onUserUpdate(updatedUser);
            onOpenChange(false);
        } catch (error) {
            console.error('Error updating preferences:', error);
        } finally {
            setIsLoading(false);
        }
    };

    // Reset form when modal opens
    React.useEffect(() => {
        if (open && user) {
            setNotificationPreferences(user.notificationPreferences || {
                connectionUpdates: true,
                weeklyNewsletter: true,
            });
        }
    }, [open, user]);

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold text-gray-900 font-ibm-plex-mono">
                        Preferences
                    </DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
                    {/* Scrollable Content */}
                    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">

                        {/* Email Notifications Section */}
                        <div className="space-y-3">
                            <h3 className="text-md font-medium font-ibm-plex-mono text-black mb-4">Email Notifications</h3>

                            <div className="space-y-4">
                                <label className="flex items-start justify-between p-3 border border-gray-300 cursor-pointer hover:bg-gray-50 transition-colors">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-sm font-ibm-plex-mono font-medium text-gray-900">Connection Updates</span>
                                        <span className="text-xs text-gray-500">Receive an email when someone requests to connect with you or accepts your request.</span>
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={notificationPreferences.connectionUpdates}
                                        onChange={(e) => setNotificationPreferences(prev => ({ ...prev, connectionUpdates: e.target.checked }))}
                                        className="w-4 h-4 mt-1 text-black border-gray-300 rounded focus:ring-black accent-black"
                                    />
                                </label>

                                <label className="flex items-start justify-between p-3 border border-gray-300 cursor-pointer hover:bg-gray-50 transition-colors">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-sm font-ibm-plex-mono font-medium text-gray-900">Weekly Newsletter</span>
                                        <span className="text-xs text-gray-500">Receive a weekly summary of new relevant indexes and connections.</span>
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={notificationPreferences.weeklyNewsletter}
                                        onChange={(e) => setNotificationPreferences(prev => ({ ...prev, weeklyNewsletter: e.target.checked }))}
                                        className="w-4 h-4 mt-1 text-black border-gray-300 rounded focus:ring-black accent-black"
                                    />
                                </label>
                            </div>
                        </div>
                    </div>

                    {/* Fixed Footer */}
                    <div className="flex justify-end space-x-3 px-6 py-4 border-t bg-white">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={isLoading}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={isLoading}
                        >
                            {isLoading ? 'Saving...' : 'Save Changes'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog.Root>
    );
}
