import { StatsRow } from '@/contours/users/components/UsersTable/StatsRow';
import { UsersTable } from '@/contours/users/components/UsersTable/UsersTable';
import { UsersToolbar } from '@/contours/users/components/UsersTable/UsersToolbar';
import { useUsersPage } from '@/contours/users/screens/useUsersPage';
import { Stack } from '@mantine/core';
// One definition of "online" for the whole panel: the dashboard used to count a
// 3-minute window while this list glowed for 5.
import { type CreateUserInput, type UpdateUserInput } from '@/lib/domain/users';
import { UserDrawer } from '@/contours/users/components/UserDrawer';

// ───── Helpers ─────

export function UsersPage() {
  const {
    qc,
    activeFilters,
    toggleSort,
    usersQuery,
    squadsQuery,
    knownTags,
    authStatusQuery,
    squadNameById,
    pagedUsers,
    totalUsers,
    stats,
    totalPages,
    safePage,
    rangeStart,
    rangeEnd,
    createMutation,
    updateMutation,
    handleRevoke,
    handleRotate,
    handleResetTraffic,
    handleDelete,
    editing,
    setEditing,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    setPage,
    rowsPerPage,
    setRowsPerPage,
    sort,
    order,
    squadFilter,
    setSquadFilter,
    tagFilter,
    setTagFilter,
    routingFilter,
    setRoutingFilter,
    createOpen,
    openCreate,
    closeCreate,
  } = useUsersPage();

  return (
    <Stack gap="lg">
      <StatsRow stats={stats} statusFilter={statusFilter} setStatusFilter={setStatusFilter} />

      <UsersToolbar qc={qc} activeFilters={activeFilters} usersQuery={usersQuery} squadsQuery={squadsQuery} knownTags={knownTags} search={search} setSearch={setSearch} squadFilter={squadFilter} setSquadFilter={setSquadFilter} tagFilter={tagFilter} setTagFilter={setTagFilter} routingFilter={routingFilter} setRoutingFilter={setRoutingFilter} openCreate={openCreate} />

      <UsersTable toggleSort={toggleSort} authStatusQuery={authStatusQuery} squadNameById={squadNameById} pagedUsers={pagedUsers} totalUsers={totalUsers} stats={stats} totalPages={totalPages} safePage={safePage} rangeStart={rangeStart} rangeEnd={rangeEnd} handleRevoke={handleRevoke} handleRotate={handleRotate} handleResetTraffic={handleResetTraffic} handleDelete={handleDelete} setEditing={setEditing} setPage={setPage} rowsPerPage={rowsPerPage} setRowsPerPage={setRowsPerPage} sort={sort} order={order} />

      <UserDrawer
        opened={createOpen}
        onClose={closeCreate}
        user={null}
        loading={createMutation.isPending}
        onSubmit={async (input) => {
          await createMutation.mutateAsync(input as CreateUserInput);
        }}
      />

      <UserDrawer
        opened={editing !== null}
        onClose={() => setEditing(null)}
        user={editing}
        loading={updateMutation.isPending}
        onSubmit={async (input) => {
          if (!editing) return;
          await updateMutation.mutateAsync({ id: editing.id, input: input as UpdateUserInput });
        }}
      />
    </Stack>
  );
}

// The presence dot lived here. The pill says ONLINE or OFFLINE in a word now,
// so a mark repeating it in colour would have made three signs for one fact,
// counting the last-online column. A word reads better than a mark, so the mark
// is what went.

